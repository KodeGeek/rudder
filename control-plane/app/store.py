"""In-memory state: connected repos, rendered jobs, run history, parsed inventory.

Connected repos are persisted to a JSON file on a volume (survive restart). Jobs
are rendered from each repo's `ansible/jobs.yml` on reconcile. Inventory is
parsed from the repo's real Ansible inventory. Private repos authenticate with a
token stored in Vault (never in repos.json). Run history is in-memory (the
durable record lives in Prometheus + Loki).
"""
import json
import os
import re
import subprocess
import threading
import time
from urllib.parse import quote, urlsplit, urlunsplit

import yaml

from . import config, vault

_lock = threading.RLock()

repos: dict = {}            # id -> ConnectedRepo (may carry transient "error")
jobs: dict = {}             # name -> job (internal, with _repoId/_workdir)
runs: dict = {}             # name -> [run]  (newest first)
manifests: dict = {}        # id -> {"jobsYaml","rudderYaml","found","playbooks"}
channels: list = []         # parsed from rudder.yml alerts across repos
repo_inventory: dict = {}   # id -> {"groups":[], "hosts":[]}

reconcile_state = {
    "lastAt": None, "intervalMin": 2, "inSync": True, "pendingCommit": None, "nextAt": None,
}

_STATUS_MAP = {"success": "ok", "failed": "fail", "running": "running"}
_INV_CANDIDATES = [
    "inventory.ini", "inventory.yml", "inventory.yaml", "inventory",
    "hosts.ini", "hosts.yml", "hosts",
    "ansible/inventory.ini", "ansible/inventory.yml", "ansible/inventory.yaml",
    "ansible/inventory", "ansible/hosts.ini", "ansible/hosts",
    "inventory/hosts", "inventory/hosts.ini", "inventories/hosts",
]
_INV_RE = re.compile(r"^(hosts|inventory)(\.(ini|yml|yaml))?$")


# ── repos persistence ──
def load_repos():
    try:
        if os.path.exists(config.STATE_FILE):
            for r in json.load(open(config.STATE_FILE)):
                r.pop("error", None)
                repos[r["id"]] = r
    except Exception as e:
        print("store: load repos failed:", e)


def save_repos():
    try:
        os.makedirs(os.path.dirname(config.STATE_FILE), exist_ok=True)
        json.dump([{k: v for k, v in r.items() if k != "error"} for r in repos.values()], open(config.STATE_FILE, "w"))
    except Exception as e:
        print("store: save repos failed:", e)


def _slug(url: str) -> str:
    s = url.rstrip("/")
    if s.endswith(".git"):
        s = s[:-4]
    parts = [p for p in s.split("/") if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else url)


def add_repo(provider: str, url: str, branch: str, token: str = "") -> dict:
    with _lock:
        slug = _slug(url)
        rid = f"{provider}:{slug}"
        repos[rid] = {
            "id": rid, "provider": provider, "slug": slug,
            "branch": branch or "main", "url": url, "addedAt": int(time.time() * 1000),
            "auth": bool(token),
        }
        save_repos()
    if token:
        try:
            vault.set_repo_token(rid, token)
        except Exception as e:
            print("store: failed to store repo token in vault:", e)
    return repos[rid]


def remove_repo(rid: str):
    with _lock:
        repos.pop(rid, None)
        for n in [n for n, j in jobs.items() if j.get("_repoId") == rid]:
            jobs.pop(n, None)
            runs.pop(n, None)
        manifests.pop(rid, None)
        repo_inventory.pop(rid, None)
        _rebuild_channels()
        save_repos()
    try:
        vault.delete_repo_token(rid)
    except Exception:
        pass


# ── reconcile (clone/pull + render) ──
def _workdir(rid: str) -> str:
    return os.path.join(config.WORKDIR, rid.replace(":", "_").replace("/", "_"))


def _redact(text: str) -> str:
    return re.sub(r"//[^@/\s]+@", "//<credentials>@", text or "")


def _auth_url(r: dict) -> str:
    """Inject a Vault-stored token into the clone URL for private repos."""
    url = r["url"]
    try:
        token = vault.get_repo_token(r["id"])
    except Exception:
        token = None
    if not token:
        return url
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or "@" in parts.netloc:
        return url
    user = {"github": "x-access-token", "ado": "pat"}.get(r.get("provider", ""), "git")
    netloc = f"{user}:{quote(token, safe='')}@{parts.netloc}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def reconcile_repo(rid: str):
    r = repos.get(rid)
    if not r:
        return
    wd = _workdir(rid)
    branch = r["branch"]
    aurl = _auth_url(r)
    ok, err = True, ""
    if os.path.isdir(os.path.join(wd, ".git")):
        f = subprocess.run(["git", "-C", wd, "fetch", "-q", aurl, branch], capture_output=True, text=True)
        if f.returncode == 0:
            subprocess.run(["git", "-C", wd, "reset", "--hard", "-q", "FETCH_HEAD"], capture_output=True)
        else:
            ok, err = False, f.stderr
    else:
        os.makedirs(config.WORKDIR, exist_ok=True)
        res = subprocess.run(["git", "clone", "-q", "--branch", branch, aurl, wd], capture_output=True, text=True)
        if res.returncode == 0:
            subprocess.run(["git", "-C", wd, "remote", "set-url", "origin", r["url"]], capture_output=True)  # scrub token
        else:
            ok, err = False, res.stderr
    if not ok:
        r["error"] = _redact(err.strip()) or "git operation failed"
        print(f"store: reconcile failed for {rid}: {_redact(err.strip())}")
        return
    r.pop("error", None)
    _render_jobs(rid, wd)
    _parse_inventory(rid, wd)


def _render_jobs(rid: str, wd: str):
    r = repos[rid]
    mpath = os.path.join(wd, "ansible", "jobs.yml")
    if not os.path.exists(mpath):
        mpath = os.path.join(wd, "jobs.yml")
    found = os.path.exists(mpath)
    try:
        manifest = yaml.safe_load(open(mpath)) or [] if found else []
    except Exception as e:
        print(f"store: manifest parse failed for {rid}: {e}")
        manifest = []
    jobs_yaml = ""
    if found:
        try:
            jobs_yaml = open(mpath).read()
        except Exception:
            pass
    rudder_yaml = ""
    rpath = os.path.join(wd, "rudder.yml")
    try:
        if os.path.exists(rpath):
            rudder_yaml = open(rpath).read()
    except Exception:
        pass
    manifests[rid] = {
        "jobsYaml": jobs_yaml, "rudderYaml": rudder_yaml,
        "found": found, "playbooks": _discover_playbooks(wd),
    }
    _rebuild_channels()
    with _lock:
        for n in [n for n, j in jobs.items() if j.get("_repoId") == rid]:
            jobs.pop(n, None)
        for entry in manifest:
            if not isinstance(entry, dict) or "name" not in entry:
                continue
            name = entry["name"]
            jobs[name] = {
                "name": name, "cron": entry.get("cron", "0 0 * * *"),
                "playbook": entry.get("playbook", ""), "limit": entry.get("limit", "all"),
                "kind": entry.get("kind", "task"), "args": entry.get("extra_args"),
                "desc": entry.get("desc", ""),
                "provider": r["provider"], "repoSlug": r["slug"], "branch": r["branch"],
                "_repoId": rid, "_workdir": wd,
            }


def _discover_playbooks(wd: str) -> list:
    out = []
    for root, dirs, files in os.walk(wd):
        if ".git" in dirs:
            dirs.remove(".git")
        for f in files:
            if not f.endswith((".yml", ".yaml")):
                continue
            p = os.path.join(root, f)
            try:
                head = open(p, errors="ignore").read(4000)
            except Exception:
                continue
            if re.search(r"^\s*-?\s*hosts:", head, re.MULTILINE):
                out.append(os.path.relpath(p, wd).replace(os.sep, "/"))
    return sorted(out)[:60]


# ── inventory parsing (the repo's real Ansible inventory) ──
def _parse_inventory(rid: str, wd: str):
    path = None
    for c in _INV_CANDIDATES:
        cand = os.path.join(wd, c)
        if os.path.isfile(cand):
            path = cand
            break
        if os.path.isdir(cand):
            for f in sorted(os.listdir(cand)):
                if f.endswith((".ini", ".yml", ".yaml")) or f in ("hosts",):
                    path = os.path.join(cand, f)
                    break
            if path:
                break
    if not path:
        # fallback: shallow walk (depth ≤ 3) for a hosts/inventory file
        for root, dirs, files in os.walk(wd):
            if ".git" in dirs:
                dirs.remove(".git")
            if root[len(wd):].count(os.sep) > 3:
                dirs[:] = []
                continue
            match = next((f for f in sorted(files) if _INV_RE.match(f)), None)
            if match:
                path = os.path.join(root, match)
                break
    if not path:
        repo_inventory.pop(rid, None)
        return
    try:
        text = open(path, errors="ignore").read()
    except Exception:
        repo_inventory.pop(rid, None)
        return
    groups, hosts = (_parse_yaml_inventory(text) if path.endswith((".yml", ".yaml"))
                     else _parse_ini_inventory(text))
    if groups or hosts:
        repo_inventory[rid] = {"groups": groups, "hosts": hosts}
    else:
        repo_inventory.pop(rid, None)


def _inv_lists(groups_map: dict, hostmap: dict):
    glist = [{"name": g, "hosts": len(hs), "up": len(hs), "desc": "from repo inventory"}
             for g, hs in groups_map.items() if hs]
    now = int(time.time() * 1000)
    hlist = [{"name": h, "group": g, "ip": "—", "os": "—", "up": True, "jobs": 0, "lastSeen": now}
             for h, g in hostmap.items()]
    return glist, hlist


def _parse_ini_inventory(text: str):
    groups_map: dict = {}
    hostmap: dict = {}
    cur = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith((";", "#")):
            continue
        if line.startswith("[") and line.endswith("]"):
            name = line[1:-1].strip()
            if ":" in name:  # [group:vars] / [group:children] — skip for host listing
                cur = None
            else:
                cur = name
                groups_map.setdefault(cur, set())
            continue
        if cur is None:
            continue
        host = line.split()[0]
        if "[" in host:  # skip range patterns like web[01:10]
            continue
        groups_map[cur].add(host)
        hostmap.setdefault(host, cur)
    return _inv_lists(groups_map, hostmap)


def _parse_yaml_inventory(text: str):
    try:
        data = yaml.safe_load(text) or {}
    except Exception:
        return [], []
    groups_map: dict = {}
    hostmap: dict = {}

    def walk(node, gname):
        if not isinstance(node, dict):
            return
        hs = node.get("hosts")
        names = list(hs.keys()) if isinstance(hs, dict) else (hs if isinstance(hs, list) else [])
        for h in names:
            groups_map.setdefault(gname, set()).add(h)
            hostmap.setdefault(h, gname)
        ch = node.get("children")
        if isinstance(ch, dict):
            for cg, cn in ch.items():
                walk(cn, cg)

    root = data.get("all") if isinstance(data.get("all"), dict) else data
    if isinstance(root, dict) and ("hosts" in root or "children" in root):
        walk(root, "all")
    else:
        for gname, node in data.items():
            walk(node, gname)
    return _inv_lists(groups_map, hostmap)


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
    groups, hosts = [], []
    seen_h = set()
    for inv in repo_inventory.values():
        groups += inv["groups"]
        for h in inv["hosts"]:
            if h["name"] in seen_h:
                continue
            seen_h.add(h["name"])
            h = {**h, "jobs": sum(1 for j in jobs.values() if j.get("limit") in (h["group"], "all"))}
            hosts.append(h)
    if groups or hosts:
        return {"groups": groups, "hosts": hosts}
    # fallback: derive from job targets + the bundled target
    limits = sorted({j["limit"] for j in jobs.values() if j.get("limit")})
    groups = [{"name": l, "hosts": 1, "up": 1, "desc": f"hosts targeted by {l}"} for l in limits] \
        or ([{"name": "targets", "hosts": 1, "up": 1, "desc": "bundled target"}] if jobs else [])
    host = {"name": config.TARGET_HOST, "group": (limits[0] if limits else "targets"),
            "ip": config.TARGET_HOST, "os": "Linux", "up": True,
            "jobs": len(jobs), "lastSeen": int(time.time() * 1000)}
    return {"groups": groups, "hosts": [host] if jobs else []}


def _rebuild_channels():
    out = []
    for m in manifests.values():
        try:
            data = yaml.safe_load(m.get("rudderYaml") or "") or {}
        except Exception:
            data = {}
        for a in (data.get("alerts") or []):
            if not isinstance(a, dict):
                continue
            t = a.get("type", "webhook")
            target = a.get("target") or t
            out.append({"type": t, "label": str(target), "target": str(target),
                        "on": a.get("on") or [], "enabled": True})
    global channels
    channels = out


def manifest_view() -> dict:
    for rid in repos:
        if rid in manifests:
            r = repos[rid]
            m = manifests[rid]
            return {**m, "slug": r["slug"], "branch": r["branch"], "provider": r["provider"]}
    return {"jobsYaml": "", "rudderYaml": "", "found": False, "playbooks": [], "slug": "", "branch": "", "provider": "git"}


def channels_view() -> list:
    return channels
