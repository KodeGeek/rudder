"""Rudder control-plane — FastAPI app, scheduler, and reconcile orchestration."""
import threading
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from . import config, gitea, runner, store, vault

app = FastAPI(title="Rudder control-plane")
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
                runner.run_job, CronTrigger.from_crontab(j["cron"]), args=[name],
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


def _boot():
    store.reconcile_state["intervalMin"] = max(1, _interval_seconds(config.RECONCILE_INTERVAL) // 60)
    try:
        if vault.wait_ready():
            vault.ensure_ssh_key()
            vault.seed_demo_secrets()
        else:
            print("main: vault not ready; continuing")
    except Exception as e:
        print("main: vault init failed:", e)
    try:
        if config.GITEA_SEED and gitea.wait_ready():
            gitea.seed()
    except Exception as e:
        print("main: gitea seed failed:", e)
    store.load_repos()
    if not scheduler.running:
        scheduler.start()
    reconcile_all()
    scheduler.add_job(reconcile_all, "interval", seconds=_interval_seconds(config.RECONCILE_INTERVAL),
                      id="reconcile", replace_existing=True)
    _booted["ok"] = True
    print("main: control-plane booted")


@app.on_event("startup")
def startup():
    threading.Thread(target=_boot, daemon=True).start()


# ── API ──
@app.get("/healthz")
def healthz():
    return {"status": "ok", "booted": _booted["ok"]}


@app.get("/info")
def info():
    return {
        "bundledRepoUrl": config.BUNDLED_REPO_URL if config.GITEA_SEED else None,
        "reconcileInterval": config.RECONCILE_INTERVAL,
    }


@app.get("/repos")
def get_repos():
    return list(store.repos.values())


class RepoIn(BaseModel):
    provider: str = "git"
    url: str
    branch: str = "main"


@app.post("/repos")
def add_repo(body: RepoIn):
    rec = store.add_repo(body.provider, body.url, body.branch)
    try:
        store.reconcile_repo(rec["id"])
        schedule_all()
    except Exception as e:
        print("main: reconcile of new repo failed:", e)
    return rec


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
    runner.run_async(name)
    return {"started": True}


@app.get("/activity")
def get_activity():
    return store.activity_view()


@app.get("/inventory")
def get_inventory():
    return store.inventory_view()


@app.get("/secrets")
def get_secrets():
    try:
        return vault.list_secret_refs()
    except Exception:
        return []
