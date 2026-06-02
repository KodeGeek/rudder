"""In-memory state: connected repos, rendered jobs, run history.

Connected repos are persisted to a JSON file on a volume (survive restart). Jobs
are rendered from each repo's `ansible/jobs.yml` on reconcile. Run history is
in-memory (the durable record lives in Prometheus + Loki).
"""
import json
import os
import subprocess
import threading
import time

import yaml

from . import config

_lock = threading.RLock()

repos: dict = {}   # id -> ConnectedRepo
jobs: dict = {}    # name -> job (internal, with _repoId/_workdir)
runs: dict = {}    # name -> [run]  (newest first)

reconcile_state = {
    "lastAt": None, "intervalMin": 2, "inSync": True, "pendingCommit": None, "nextAt": None,
}

_STATUS_MAP = {"success": "ok", "failed": "fail", "running": "running"}


# ── repos persistence ──
def load_repos():
    try:
        if os.path.exists(config.STATE_FILE):
            for r in json.load(open(config.STATE_FILE)):
                repos[r["id"]] = r
    except Exception as e:
        print("store: load repos failed:", e)


def save_repos():
    try:
        os.makedirs(os.path.dirname(config.STATE_FILE), exist_ok=True)
        json.dump(list(repos.values()), open(config.STATE_FILE, "w"))
    except Exception as e:
        print("store: save repos failed:", e)


def _slug(url: str) -> str:
    s = url.rstrip("/")
    if s.endswith(".git"):
        s = s[:-4]
    parts = [p for p in s.split("/") if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else url)


def add_repo(provider: str, url: str, branch: str) -> dict:
    with _lock:
        slug = _slug(url)
        rid = f"{provider}:{slug}"
        repos[rid] = {
            "id": rid, "provider": provider, "slug": slug,
            "branch": branch or "main", "url": url, "addedAt": int(time.time() * 1000),
        }
        save_repos()
        return repos[rid]


def remove_repo(rid: str):
    with _lock:
        repos.pop(rid, None)
        for n in [n for n, j in jobs.items() if j.get("_repoId") == rid]:
            jobs.pop(n, None)
            runs.pop(n, None)
        save_repos()


# ── reconcile (clone/pull + render) ──
def _workdir(rid: str) -> str:
    return os.path.join(config.WORKDIR, rid.replace(":", "_").replace("/", "_"))


def reconcile_repo(rid: str):
    r = repos.get(rid)
    if not r:
        return
    wd = _workdir(rid)
    branch = r["branch"]
    if os.path.isdir(os.path.join(wd, ".git")):
        subprocess.run(["git", "-C", wd, "fetch", "--all", "-q"], capture_output=True)
        subprocess.run(["git", "-C", wd, "reset", "--hard", f"origin/{branch}"], capture_output=True)
    else:
        os.makedirs(config.WORKDIR, exist_ok=True)
        res = subprocess.run(["git", "clone", "-q", "--branch", branch, r["url"], wd], capture_output=True, text=True)
        if res.returncode != 0:
            print(f"store: clone failed for {rid}: {res.stderr.strip()}")
            return
    _render_jobs(rid, wd)


def _render_jobs(rid: str, wd: str):
    r = repos[rid]
    mpath = os.path.join(wd, "ansible", "jobs.yml")
    if not os.path.exists(mpath):
        mpath = os.path.join(wd, "jobs.yml")
    try:
        manifest = yaml.safe_load(open(mpath)) or []
    except Exception as e:
        print(f"store: manifest parse failed for {rid}: {e}")
        manifest = []
    with _lock:
        for n in [n for n, j in jobs.items() if j.get("_repoId") == rid]:
            jobs.pop(n, None)
        for entry in manifest:
            if not isinstance(entry, dict) or "name" not in entry:
                continue
            name = entry["name"]
            jobs[name] = {
                "name": name,
                "cron": entry.get("cron", "0 0 * * *"),
                "playbook": entry.get("playbook", ""),
                "limit": entry.get("limit", "all"),
                "kind": entry.get("kind", "task"),
                "args": entry.get("extra_args"),
                "desc": entry.get("desc", ""),
                "provider": r["provider"],
                "repoSlug": r["slug"],
                "branch": r["branch"],
                "_repoId": rid,
                "_workdir": wd,
            }


# ── run history ──
def add_run(name: str, run: dict):
    with _lock:
        runs.setdefault(name, []).insert(0, run)
        runs[name] = runs[name][:50]


def replace_run(name: str, run_id: str, run: dict):
    with _lock:
        lst = runs.setdefault(name, [])
        for i, r in enumerate(lst):
            if r["id"] == run_id:
                lst[i] = run
                return
        lst.insert(0, run)


# ── views (shaped for the web-ui types) ──
def job_view(name: str, next_ms=None, with_runs: bool = False) -> dict:
    j = jobs[name]
    rl = runs.get(name, [])
    latest = rl[0] if rl else None
    completed = [r for r in rl if r["status"] != "running"]
    total = len(completed)
    succ = sum(1 for r in completed if r["status"] == "success")
    status = _STATUS_MAP.get(latest["status"], "never") if latest else "never"
    return {
        "name": j["name"], "cron": j["cron"], "playbook": j["playbook"], "limit": j["limit"],
        "kind": j["kind"], "args": j.get("args"), "desc": j.get("desc", ""),
        "provider": j["provider"], "repoSlug": j["repoSlug"], "branch": j["branch"], "enabled": True,
        "status": status,
        "lastRun": latest["at"] if latest else None,
        "duration": latest.get("duration") if latest else None,
        "exit": latest.get("exit") if latest else None,
        "successRate": round(succ / total * 100) if total else None,
        "spark": [{"d": (r.get("duration") or 0), "ok": r["status"] == "success"}
                  for r in reversed(completed[:24])],
        "runs": rl[:30] if with_runs else [],
        "nextRun": next_ms,
    }


def activity_view() -> list:
    items = []
    for name, rl in runs.items():
        j = jobs.get(name)
        if not j:
            continue
        for r in rl[:8]:
            items.append({
                "job": name, "provider": j["provider"], "status": r["status"], "at": r["at"],
                "duration": r.get("duration"), "host": r.get("host"), "exit": r.get("exit"),
                "kind": j["kind"], "runId": r["id"],
            })
    items.sort(key=lambda x: x["at"], reverse=True)
    return items[:100]


def inventory_view() -> dict:
    limits = sorted({j["limit"] for j in jobs.values() if j.get("limit")})
    groups = [{"name": l, "hosts": 1, "up": 1, "desc": f"hosts targeted by {l}"} for l in limits] \
        or [{"name": "targets", "hosts": 1, "up": 1, "desc": "bundled target"}]
    host = {
        "name": config.TARGET_HOST, "group": (limits[0] if limits else "targets"),
        "ip": config.TARGET_HOST, "os": "Linux", "up": True,
        "jobs": len(jobs), "lastSeen": int(time.time() * 1000),
    }
    return {"groups": groups, "hosts": [host]}
