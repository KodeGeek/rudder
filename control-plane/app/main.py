"""Rudder control-plane — FastAPI app, scheduler, and reconcile orchestration."""
import os
import threading
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import auth, config, gitea, host, runner, store, vault

# Auth guards every route; probe/schema paths are excluded inside require_auth.
app = FastAPI(title="Rudder control-plane", dependencies=[Depends(auth.require_auth)])
scheduler = BackgroundScheduler(timezone="UTC")
_booted = {"ok": False}


def _interval_seconds(s: str) -> int:
    s = (s or "").strip().lower()
    try:
        if s.endswith("m"):
            return int(s[:-1]) * 60
        if s.endswith("h"):
            return int(s[:-1]) * 3600
        if s.endswith("s"):
            return int(s[:-1])
        return int(s)
    except ValueError:
        return 120


def _next_ms(name: str):
    try:
        job = scheduler.get_job(f"job:{name}")
        if job and job.next_run_time:
            return int(job.next_run_time.timestamp() * 1000)
    except Exception:
        pass
    return None


def schedule_all():
    if not scheduler.running:
        return
    current = {f"job:{n}" for n in store.jobs}
    for sj in scheduler.get_jobs():
        if sj.id.startswith("job:") and sj.id not in current:
            scheduler.remove_job(sj.id)
    for name, j in store.jobs.items():
        try:
            scheduler.add_job(
                runner.submit_scheduled, CronTrigger.from_crontab(j["cron"]), args=[name],
                id=f"job:{name}", replace_existing=True,
                misfire_grace_time=60, coalesce=True, max_instances=1,
            )
        except Exception as e:
            print(f"main: failed to schedule {name}: {e}")


def reconcile_all():
    for rid in list(store.repos.keys()):
        try:
            store.reconcile_repo(rid)
        except Exception as e:
            print(f"main: reconcile failed for {rid}: {e}")
    now = int(time.time() * 1000)
    store.reconcile_state["lastAt"] = now
    store.reconcile_state["nextAt"] = now + _interval_seconds(config.RECONCILE_INTERVAL) * 1000
    schedule_all()
    try:
        store.probe_inventory()  # refresh host up/down after a pull (also runs on its own interval)
    except Exception as e:
        print("main: inventory probe failed:", e)


def _boot():
    store.reconcile_state["intervalMin"] = max(1, _interval_seconds(config.RECONCILE_INTERVAL) // 60)
    if vault.wait_ready():
        # The KV engine may not be mounted the instant Vault unseals (the bundled
        # unseal sidecar enables secret/ just after init), so retry until writes land.
        for attempt in range(30):
            try:
                vault.ensure_ssh_key()
                if config.GITEA_SEED:  # placeholder refs are demo content — not for real deploys
                    vault.seed_demo_secrets()
                break
            except Exception as e:
                print(f"main: vault init attempt {attempt + 1} failed: {e}")
                time.sleep(3)
    else:
        print("main: vault not ready; continuing")
    try:
        if config.GITEA_SEED and gitea.wait_ready():
            gitea.seed()
    except Exception as e:
        print("main: gitea seed failed:", e)
    store.load_repos()
    store.load_runs()
    if not scheduler.running:
        scheduler.start()
    reconcile_all()
    scheduler.add_job(reconcile_all, "interval", seconds=_interval_seconds(config.RECONCILE_INTERVAL),
                      id="reconcile", replace_existing=True)
    scheduler.add_job(store.probe_inventory, "interval", seconds=60,
                      id="reachability", replace_existing=True, max_instances=1, coalesce=True)
    _booted["ok"] = True
    print("main: control-plane booted")


@app.on_event("startup")
def startup():
    threading.Thread(target=_boot, daemon=True).start()


# ── API ──
@app.get("/healthz")
def healthz():
    return {"status": "ok", "booted": _booted["ok"]}


@app.get("/readyz")
def readyz():
    ready = _booted["ok"] and scheduler.running
    return JSONResponse({"ready": ready}, status_code=200 if ready else 503)


@app.get("/auth/verify")
def auth_verify(principal: auth.Principal = Depends(auth.require_auth)):
    return {"ok": True, "role": principal.role, "authRequired": bool(config.API_KEY)}


@app.get("/info")
def info():
    return {
        "bundledRepoUrl": config.BUNDLED_REPO_URL if config.GITEA_SEED else None,
        "reconcileInterval": config.RECONCILE_INTERVAL,
    }


@app.get("/repos")
def get_repos():
    # flags reflect live Vault state (so replacing/clearing a secret is accurate);
    # the secret values themselves are never returned.
    return [
        {**r, "hostKey": store._safe_has_host_key(r["id"]), "vaultPass": store._safe_has_vault_pass(r["id"])}
        for r in store.repos.values()
    ]


class RepoIn(BaseModel):
    provider: str = "git"
    url: str
    branch: str = "main"
    token: str = ""
    authMethod: str = ""
    vaultPass: str = ""


@app.post("/repos")
def add_repo(body: RepoIn):
    rec = store.add_repo(body.provider, body.url, body.branch, body.token, body.authMethod, body.vaultPass)
    try:
        store.reconcile_repo(rec["id"])
        schedule_all()
    except Exception as e:
        print("main: reconcile of new repo failed:", e)
    # surface a clone/auth error so the UI can show why a repo isn't syncing
    return store.repos.get(rec["id"], rec)


class CredsIn(BaseModel):
    rid: str
    hostKey: str = ""      # SSH private key the operator's fleet authorizes (for runs)
    vaultPass: str = ""    # ansible-vault password
    token: str = ""        # git token (re-auth)


@app.post("/repos/credentials")
def set_credentials(body: CredsIn):
    """Write-only: store run/decrypt secrets in Vault. NEVER returns secret
    values — only boolean 'configured' flags. Submitting a value overwrites it."""
    r = store.repos.get(body.rid)
    if not r:
        raise HTTPException(status_code=404, detail="repo not found")
    if body.hostKey:
        vault.set_repo_host_key(body.rid, body.hostKey)
        r["hostKey"] = True
    if body.vaultPass:
        vault.set_repo_vault_pass(body.rid, body.vaultPass)
        r["vaultPass"] = True
    if body.token:
        vault.set_repo_token(body.rid, body.token)
        r["auth"] = True
        try:
            store.reconcile_repo(body.rid)
            schedule_all()
        except Exception as e:
            print("main: reconcile after token update failed:", e)
    store.save_repos()
    return r


class DeployKeyIn(BaseModel):
    provider: str = "git"
    url: str


@app.post("/deploy-key")
def deploy_key(body: DeployKeyIn):
    """Generate (if needed) a per-repo deploy keypair; return the PUBLIC key for
    the operator to add to the repo's deploy keys on the provider side."""
    rid = f"{body.provider}:{store._slug(body.url)}"
    pub = vault.ensure_repo_deploy_key(rid)
    return {"rid": rid, "publicKey": pub, "sshUrl": store._ssh_url(body.url)}


@app.delete("/repos/{rid:path}")
def delete_repo(rid: str):
    store.remove_repo(rid)
    schedule_all()
    return Response(status_code=204)


@app.get("/reconcile")
def get_reconcile():
    return store.reconcile_state


@app.post("/reconcile")
def post_reconcile():
    reconcile_all()
    return store.reconcile_state


@app.get("/jobs")
def get_jobs():
    return [store.job_view(n, _next_ms(n)) for n in store.jobs]


@app.get("/jobs/{name}")
def get_job(name: str):
    if name not in store.jobs:
        raise HTTPException(status_code=404, detail="job not found")
    return store.job_view(name, _next_ms(name), with_runs=True)


@app.post("/jobs/{name}/run")
def run_now(name: str):
    if name not in store.jobs:
        raise HTTPException(status_code=404, detail="job not found")
    try:
        runner.run_async(name)
    except runner.AlreadyRunning:
        raise HTTPException(status_code=409, detail="a run for this job is already in progress")
    except runner.QueueFull:
        raise HTTPException(status_code=429, detail="run queue full — try again shortly")
    return {"started": True}


@app.post("/jobs/{name}/runs/{run_id}/stop")
def stop_run(name: str, run_id: str):
    if name not in store.jobs:
        raise HTTPException(status_code=404, detail="job not found")
    return {"stopped": runner.stop_run(run_id)}


@app.get("/jobs/{name}/playbook")
def get_playbook(name: str):
    j = store.jobs.get(name)
    if not j:
        raise HTTPException(status_code=404, detail="job not found")
    path = runner._resolve_playbook(j)
    rel = j.get("playbook", "")
    try:
        if path:
            rel = os.path.relpath(path, j.get("_workdir") or os.path.dirname(path))
        with open(path) as f:
            return {"path": rel, "content": f.read(262144), "found": True}  # cap 256 KiB
    except Exception:
        return {"path": rel, "content": "", "found": False}


@app.get("/host-stats")
def host_stats():
    return host.stats()


@app.get("/activity")
def get_activity():
    return store.activity_view()


@app.get("/inventory")
def get_inventory():
    return store.inventory_view()


@app.get("/manifest")
def get_manifest():
    return store.manifest_view()


@app.get("/channels")
def get_channels():
    return store.channels_view()


@app.get("/secrets")
def get_secrets():
    try:
        return vault.list_secret_refs()
    except Exception:
        return []
