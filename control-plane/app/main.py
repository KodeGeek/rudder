"""Rudder control-plane — FastAPI app, scheduler, and reconcile orchestration."""
import os
import threading
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from typing import Optional

from . import alerts, audit, auth, config, gitea, host, log, metrics, runner, store, vault
from pydantic import ConfigDict

# Auth guards every route; probe/schema paths are excluded inside require_auth.
app = FastAPI(title="Rudder control-plane", dependencies=[Depends(auth.require_auth)])

# ── Response Models ──
class HealthzResponse(BaseModel):
    status: str
    booted: bool


class ReadyzResponse(BaseModel):
    ready: bool


class AuthVerifyResponse(BaseModel):
    ok: bool
    role: str
    authRequired: bool


class InfoResponse(BaseModel):
    bundledRepoUrl: Optional[str]
    reconcileInterval: str


class Commit(BaseModel):
    sha: str = ""
    msg: str = ""
    author: str = ""
    at: int = 0


class ConnectedRepo(BaseModel):
    id: str
    provider: str
    slug: str
    branch: str
    url: str
    addedAt: int
    auth: bool = False
    authMethod: str = ""
    hostKey: bool = False
    vaultPass: bool = False
    lastCommit: Optional[Commit] = None
    sync: str = ""
    error: Optional[str] = None
    model_config = ConfigDict(extra="ignore")


class DeployKeyResponse(BaseModel):
    rid: str
    publicKey: str
    sshUrl: str


class ReconcileState(BaseModel):
    lastAt: Optional[int]
    intervalMin: int
    inSync: bool
    pendingCommit: None = None
    nextAt: Optional[int]


class SparkPoint(BaseModel):
    d: int
    ok: bool


class Run(BaseModel):
    id: str
    at: int
    status: str
    duration: Optional[int] = None
    exit: Optional[int] = None
    host: str = ""


class JobView(BaseModel):
    name: str
    cron: str
    playbook: str
    limit: str
    kind: str
    args: Optional[str] = None
    desc: str = ""
    provider: str
    repoSlug: str
    branch: str
    enabled: bool
    status: str
    lastRun: Optional[int] = None
    duration: Optional[int] = None
    exit: Optional[int] = None
    successRate: Optional[int] = None
    spark: list[SparkPoint]
    runs: list[Run]
    nextRun: Optional[int] = None


class ActivityItem(BaseModel):
    job: str
    provider: str
    status: str
    at: int
    duration: Optional[int] = None
    host: str = ""
    exit: Optional[int] = None
    kind: str
    runId: str


class Group(BaseModel):
    name: str
    hosts: int
    up: int
    desc: str


class Host(BaseModel):
    name: str
    group: str
    ip: str
    os: str
    up: bool
    jobs: int
    lastSeen: Optional[int] = None   # None until the host has been probed


class InventoryResponse(BaseModel):
    groups: list[Group]
    hosts: list[Host]


class ManifestView(BaseModel):
    jobsYaml: str
    rudderYaml: str
    found: bool
    playbooks: list[str]
    slug: str = ""
    branch: str = ""
    provider: str = ""


class Channel(BaseModel):
    type: str
    label: str
    target: str
    on: list[str]
    enabled: bool


class DashboardWidget(BaseModel):
    type: str
    x: int
    y: int
    w: int
    h: int
    metric: Optional[str] = None
    model_config = ConfigDict(extra="ignore")


class DashboardResponse(BaseModel):
    cols: int
    widgets: Optional[list[DashboardWidget]] = None


class ReachabilitySettings(BaseModel):
    intervalSeconds: int
    timeoutSeconds: float
    attempts: int
    downAfter: int


class SettingsResponse(BaseModel):
    reconcileSeconds: int
    runWorkers: int
    runQueueMax: int
    runTimeoutSeconds: int
    sshStrict: bool
    reachability: ReachabilitySettings
    model_config = ConfigDict(extra="ignore")


class PlaybookResponse(BaseModel):
    path: str
    content: str
    found: bool


class UsageStat(BaseModel):
    used: int
    total: int
    pct: float


class HostStatsResponse(BaseModel):
    cpu: Optional[float] = None
    mem: Optional[UsageStat] = None    # {used,total,pct} — not a bare float
    disk: Optional[UsageStat] = None
    source: Optional[str] = None
    error: Optional[str] = None
    model_config = ConfigDict(extra="ignore")


class AuditEntry(BaseModel):
    at: int
    principal: str
    role: str
    action: str
    target: str
    source_ip: str
    detail: str = ""
    model_config = ConfigDict(extra="ignore")


class SecretRef(BaseModel):
    ref: str
    used: int
    rotated: int
    kind: str
    rotatable: bool = False
    warn: Optional[bool] = None
    model_config = ConfigDict(extra="ignore")


class RunStartResponse(BaseModel):
    started: bool


class RunStopResponse(BaseModel):
    stopped: bool


class RotateSecretResponse(BaseModel):
    public: str
    rotated: int


class ChannelTestResponse(BaseModel):
    sent: bool
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
    # Snapshot under the store lock: reconcile_repo → _render_jobs mutates
    # store.jobs concurrently, so iterating it live risks "dict changed size".
    with store._lock:
        snapshot = list(store.jobs.items())
    current = {f"job:{n}" for n, _ in snapshot}
    for sj in scheduler.get_jobs():
        if sj.id.startswith("job:") and sj.id not in current:
            scheduler.remove_job(sj.id)
    for name, j in snapshot:
        try:
            scheduler.add_job(
                runner.submit_scheduled, CronTrigger.from_crontab(j["cron"]), args=[name],
                id=f"job:{name}", replace_existing=True,
                misfire_grace_time=60, coalesce=True, max_instances=1,
            )
        except Exception as e:
            print(f"main: failed to schedule {name}: {e}")


_scheduled = {"reconcile": None, "reachability": None}


def _apply_runtime_settings():
    """Re-apply rudder.yml `settings:` that affect the scheduler/pool when they
    change: the reconcile + reachability intervals and the run-pool size. No-op
    for anything unchanged."""
    if not scheduler.running:
        return
    targets = {
        "reconcile": int(store.settings["reconcileSeconds"]),
        "reachability": int(store.settings["reachability"]["intervalSeconds"]),
    }
    for job_id, secs in targets.items():
        if secs != _scheduled[job_id]:
            try:
                scheduler.reschedule_job(job_id, trigger="interval", seconds=secs)
                _scheduled[job_id] = secs
                print(f"main: {job_id} interval set to {secs}s")
            except Exception as e:
                print(f"main: reschedule {job_id} failed:", e)
    try:
        runner.apply_workers(int(store.settings["runWorkers"]))
    except Exception as e:
        print("main: apply run workers failed:", e)


def reconcile_all():
    started = time.time()
    ok = True
    for rid in list(store.repos.keys()):
        try:
            store.reconcile_repo(rid)
        except Exception as e:
            ok = False
            print(f"main: reconcile failed for {rid}: {e}")
    now = int(time.time() * 1000)
    rec_sec = int(store.settings["reconcileSeconds"])
    store.reconcile_state["lastAt"] = now
    store.reconcile_state["nextAt"] = now + rec_sec * 1000
    store.reconcile_state["intervalMin"] = max(1, rec_sec // 60)
    schedule_all()
    _apply_runtime_settings()   # apply any settings: changes from rudder.yml (intervals, workers)
    try:
        store.probe_inventory()  # refresh host up/down after a pull (also runs on its own interval)
    except Exception as e:
        print("main: inventory probe failed:", e)
    dur = time.time() - started
    metrics.record_reconcile(ok, dur)
    log.info("reconcile complete", ok=ok, duration=round(dur, 2), repos=len(store.repos), jobs=len(store.jobs))


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
    reaped = store.reap_orphaned_runs()   # runs orphaned by a previous process restart
    if reaped:
        print(f"main: reaped {reaped} orphaned run(s) left 'running' by a prior process")
    store.load_runs()
    if not scheduler.running:
        scheduler.start()
    # Register the interval jobs first (at current/default settings) so the first
    # reconcile can reschedule them to whatever rudder.yml's settings: block says.
    scheduler.add_job(reconcile_all, "interval", seconds=int(store.settings["reconcileSeconds"]),
                      id="reconcile", replace_existing=True)
    scheduler.add_job(store.probe_inventory, "interval", seconds=int(store.settings["reachability"]["intervalSeconds"]),
                      id="reachability", replace_existing=True, max_instances=1, coalesce=True)
    _scheduled["reconcile"] = int(store.settings["reconcileSeconds"])
    _scheduled["reachability"] = int(store.settings["reachability"]["intervalSeconds"])
    reconcile_all()   # loads rudder.yml settings, then re-applies intervals/pool
    _booted["ok"] = True
    print("main: control-plane booted")


@app.on_event("startup")
def startup():
    threading.Thread(target=_boot, daemon=True).start()


@app.on_event("shutdown")
def shutdown():
    # SIGTERM → stop scheduling new runs and terminate in-flight ones cleanly.
    try:
        if scheduler.running:
            scheduler.shutdown(wait=False)
    except Exception as e:
        print("main: scheduler shutdown error:", e)
    runner.shutdown()


# ── API ──
@app.get("/healthz", response_model=HealthzResponse)
def healthz():
    return {"status": "ok", "booted": _booted["ok"]}


@app.get("/readyz")
def readyz():
    ready = _booted["ok"] and scheduler.running
    return JSONResponse({"ready": ready}, status_code=200 if ready else 503)


@app.get("/metrics")
def metrics_endpoint():
    metrics.scheduler_running.set(1 if scheduler.running else 0)
    metrics.jobs_total.set(len(store.jobs))
    metrics.repos_total.set(len(store.repos))
    metrics.runs_active.set(runner.active_count())
    metrics.vault_up.set(1 if vault.is_up() else 0)
    data, ctype = metrics.render()
    return Response(content=data, media_type=ctype)


@app.get("/auth/verify", response_model=AuthVerifyResponse)
def auth_verify(principal: auth.Principal = Depends(auth.require_auth)):
    return {"ok": True, "role": principal.role, "authRequired": bool(config.API_KEY)}


@app.get("/info", response_model=InfoResponse)
def info():
    return {
        "bundledRepoUrl": config.BUNDLED_REPO_URL if config.GITEA_SEED else None,
        "reconcileInterval": config.RECONCILE_INTERVAL,
    }


@app.get("/repos", response_model=list[ConnectedRepo])
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


@app.post("/repos", response_model=ConnectedRepo)
def add_repo(body: RepoIn, request: Request,
             principal: auth.Principal = Depends(auth.require_role(*auth.WRITERS))):
    rec = store.add_repo(body.provider, body.url, body.branch, body.token, body.authMethod, body.vaultPass)
    audit.record(principal, "repo.add", body.url, request)
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


@app.post("/repos/credentials", response_model=ConnectedRepo)
def set_credentials(body: CredsIn, request: Request,
                    principal: auth.Principal = Depends(auth.require_role(*auth.ADMINS))):
    """Write-only: store run/decrypt secrets in Vault. NEVER returns secret
    values — only boolean 'configured' flags. Submitting a value overwrites it."""
    r = store.repos.get(body.rid)
    if not r:
        raise HTTPException(status_code=404, detail="repo not found")
    set_fields = [k for k in ("hostKey", "vaultPass", "token") if getattr(body, k)]
    audit.record(principal, "repo.credentials", body.rid, request, detail="set:" + ",".join(set_fields))
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


@app.post("/deploy-key", response_model=DeployKeyResponse)
def deploy_key(body: DeployKeyIn, request: Request,
               principal: auth.Principal = Depends(auth.require_role(*auth.WRITERS))):
    """Generate (if needed) a per-repo deploy keypair; return the PUBLIC key for
    the operator to add to the repo's deploy keys on the provider side."""
    rid = f"{body.provider}:{store._slug(body.url)}"
    pub = vault.ensure_repo_deploy_key(rid)
    audit.record(principal, "repo.deploy-key", rid, request)
    return {"rid": rid, "publicKey": pub, "sshUrl": store._ssh_url(body.url)}


@app.delete("/repos/{rid:path}")
def delete_repo(rid: str, request: Request,
                principal: auth.Principal = Depends(auth.require_role(*auth.ADMINS))):
    store.remove_repo(rid)
    audit.record(principal, "repo.remove", rid, request)
    schedule_all()
    return Response(status_code=204)


@app.get("/reconcile", response_model=ReconcileState)
def get_reconcile():
    return store.reconcile_state


@app.post("/reconcile", response_model=ReconcileState)
def post_reconcile(request: Request,
                   principal: auth.Principal = Depends(auth.require_role(*auth.WRITERS))):
    audit.record(principal, "reconcile", "", request)
    reconcile_all()
    return store.reconcile_state


@app.get("/jobs", response_model=list[JobView])
def get_jobs():
    return [store.job_view(n, _next_ms(n)) for n in store.jobs]


@app.get("/jobs/{name}", response_model=JobView)
def get_job(name: str):
    if name not in store.jobs:
        raise HTTPException(status_code=404, detail="job not found")
    return store.job_view(name, _next_ms(name), with_runs=True)


@app.post("/jobs/{name}/run", response_model=RunStartResponse)
def run_now(name: str, request: Request,
            principal: auth.Principal = Depends(auth.require_role(*auth.WRITERS))):
    if name not in store.jobs:
        raise HTTPException(status_code=404, detail="job not found")
    try:
        runner.run_async(name)
    except runner.AlreadyRunning:
        raise HTTPException(status_code=409, detail="a run for this job is already in progress")
    except runner.QueueFull:
        raise HTTPException(status_code=429, detail="run queue full — try again shortly")
    audit.record(principal, "job.run", name, request)
    return {"started": True}


@app.post("/jobs/{name}/runs/{run_id}/stop", response_model=RunStopResponse)
def stop_run(name: str, run_id: str, request: Request,
             principal: auth.Principal = Depends(auth.require_role(*auth.WRITERS))):
    if name not in store.jobs:
        raise HTTPException(status_code=404, detail="job not found")
    audit.record(principal, "job.stop", name, request, detail=run_id)
    return {"stopped": runner.stop_run(run_id)}


@app.get("/jobs/{name}/playbook", response_model=PlaybookResponse)
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


@app.get("/host-stats", response_model=HostStatsResponse)
def host_stats():
    return host.stats()


@app.get("/activity", response_model=list[ActivityItem])
def get_activity():
    return store.activity_view()


@app.get("/inventory", response_model=InventoryResponse)
def get_inventory():
    return store.inventory_view()


@app.get("/manifest", response_model=ManifestView)
def get_manifest():
    return store.manifest_view()


@app.get("/channels", response_model=list[Channel])
def get_channels():
    return store.channels_view()


@app.get("/dashboard", response_model=DashboardResponse)
def get_dashboard():
    """The committed Overview layout (dashboard: in rudder.yml), or widgets:null
    when none is set so the UI uses its built-in default layout."""
    return store.dashboard_view() or {"cols": 12, "widgets": None}


@app.get("/settings", response_model=SettingsResponse)
def get_settings():
    """Effective operational settings — built-in defaults plus any overrides from
    the `settings:` block in rudder.yml. Secret values are never included here."""
    return store.settings


class ChannelTest(BaseModel):
    type: str = "webhook"
    target: str = ""


@app.post("/channels/test", response_model=ChannelTestResponse)
def test_channel(body: ChannelTest, request: Request,
                 principal: auth.Principal = Depends(auth.require_role(*auth.WRITERS))):
    audit.record(principal, "channel.test", body.target, request)
    try:
        ok = alerts.test_channel({"type": body.type, "target": body.target, "label": body.target})
        return {"sent": ok}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"test failed: {e}")


@app.get("/audit", response_model=list[AuditEntry])
def get_audit(principal: auth.Principal = Depends(auth.require_role(*auth.ADMINS))):
    return audit.recent()


@app.get("/secrets", response_model=list[SecretRef])
def get_secrets():
    try:
        return vault.list_secret_refs()
    except Exception:
        return []


@app.post("/secrets/rotate", response_model=RotateSecretResponse)
def rotate_secret(request: Request,
                  principal: auth.Principal = Depends(auth.require_role(*auth.ADMINS))):
    """Rotate the Rudder-managed run SSH key. Operator-supplied secrets (git
    tokens, vault passwords) are rotated by re-submitting them via Credentials."""
    try:
        res = vault.rotate_ssh_key()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"rotate failed: {e}")
    audit.record(principal, "secret.rotate", "vault/ssh-deploy-key", request)
    return res
