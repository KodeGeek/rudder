"""In-memory state: connected repos, rendered jobs, run history, parsed inventory.

Connected repos are persisted to a JSON file on a volume (survive restart). Jobs
are rendered from each repo's `ansible/jobs.yml` on reconcile. Inventory is
parsed from the repo's real Ansible inventory. Private repos authenticate with a
token stored in Vault (never in repos.json). Run history is persisted to a JSON
file on the same volume as repos.json so it survives restarts; Prometheus + Loki
remain the long-term durable record.
"""
import json
import os
import re
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlsplit, urlunsplit

import yaml

from . import config, db, vault

_lock = threading.RLock()
_migrated = False

repos: dict = {}            # id -> ConnectedRepo (may carry transient "error")
jobs: dict = {}             # name -> job (internal, with _repoId/_workdir)
runs: dict = {}             # name -> [run]  (newest first)
manifests: dict = {}        # id -> {"jobsYaml","rudderYaml","found","playbooks"}
channels: list = []         # parsed from rudder.yml alerts across repos
repo_inventory: dict = {}   # id -> {"groups":{g:[hosts]}, "hostmap":{host:group}, "hostinfo":{host:{addr,port}}}
host_reach: dict = {}       # host name -> {"up": bool, "lastSeen": ms|None}  (live TCP reachability)

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


# ── one-time migration from the legacy JSON files ──
def _ensure_migrated():
    """Import repos.json/runs.json into SQLite once, then retire the JSON files."""
    global _migrated
    with _lock:
        if _migrated:
            return
        _migrated = True
        try:
            if db.repo_count() == 0 and os.path.exists(config.STATE_FILE):
                imported = []
                for r in json.load(open(config.STATE_FILE)):
                    r.pop("error", None)
                    imported.append(r)
                if imported:
                    db.set_repos(imported)
                os.rename(config.STATE_FILE, config.STATE_FILE + ".imported")
        except Exception as e:
            print("store: migrate repos failed:", e)
        try:
            if db.run_count() == 0 and os.path.exists(config.RUNS_FILE):
                for name, rl in (json.load(open(config.RUNS_FILE)) or {}).items():
                    for r in reversed(rl):          # insert oldest-first so prune keeps newest
                        db.insert_run(name, r)
                os.rename(config.RUNS_FILE, config.RUNS_FILE + ".imported")
        except Exception as e:
            print("store: migrate runs failed:", e)


# ── repos persistence ──
def load_repos():
    _ensure_migrated()
    try:
        for r in db.all_repos():
            r.pop("error", None)
            repos[r["id"]] = r
    except Exception as e:
        print("store: load repos failed:", e)


def save_repos():
    try:
        db.set_repos([{k: v for k, v in r.items() if k != "error"} for r in repos.values()])
    except Exception as e:
        print("store: save repos failed:", e)


def _slug(url: str) -> str:
    s = url.rstrip("/")
    if s.endswith(".git"):
        s = s[:-4]
    parts = [p for p in s.split("/") if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else url)


def _safe_has_vault_pass(rid: str) -> bool:
    try:
        return vault.has_repo_vault_pass(rid)
    except Exception:
        return False


def _safe_has_host_key(rid: str) -> bool:
    try:
        return vault.has_repo_host_key(rid)
    except Exception:
        return False


def add_repo(provider: str, url: str, branch: str, token: str = "", auth_method: str = "", vault_pass: str = "") -> dict:
    method = auth_method or ("token" if token else "none")
    with _lock:
        slug = _slug(url)
        rid = f"{provider}:{slug}"
        repos[rid] = {
            "id": rid, "provider": provider, "slug": slug,
            "branch": branch or "main", "url": url, "addedAt": int(time.time() * 1000),
            "auth": method != "none", "authMethod": method,
            "vaultPass": bool(vault_pass) or _safe_has_vault_pass(rid),
            "hostKey": _safe_has_host_key(rid),
        }
        save_repos()
    if token:
        try:
            vault.set_repo_token(rid, token)
        except Exception as e:
            print("store: failed to store repo token in vault:", e)
    if vault_pass:
        try:
            vault.set_repo_vault_pass(rid, vault_pass)
            repos[rid]["vaultPass"] = True
        except Exception as e:
            print("store: failed to store ansible-vault password in vault:", e)
    return repos[rid]


def remove_repo(rid: str):
    with _lock:
        repos.pop(rid, None)
        for n in [n for n, j in jobs.items() if j.get("_repoId") == rid]:
            jobs.pop(n, None)
            runs.pop(n, None)
            db.delete_job_runs(n)
        manifests.pop(rid, None)
        repo_inventory.pop(rid, None)
        _rebuild_channels()
        save_repos()
    try:
        vault.delete_repo_token(rid)
        vault.delete_repo_deploy_key(rid)
        vault.delete_repo_vault_pass(rid)
        vault.delete_repo_host_key(rid)
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


def _ssh_url(url: str) -> str:
    """Convert an https repo URL to its SSH form for deploy-key clones."""
    p = urlsplit(url)
    if p.scheme not in ("http", "https"):
        return url  # already ssh/scp form
    host = p.netloc.split("@")[-1].split(":")[0]
    path = p.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if host == "github.com" or host.endswith(".github.com"):
        # github.com:22 is often blocked; SSH over 443 via ssh.github.com is reliable.
        return f"ssh://git@ssh.github.com:443/{path}.git"
    if "dev.azure.com" in host or "visualstudio.com" in host:
        # https://dev.azure.com/org/project/_git/repo → git@ssh.dev.azure.com:v3/org/project/repo
        return f"git@ssh.dev.azure.com:v3/{path.replace('/_git/', '/')}"
    return f"git@{host}:{path}.git"


def reconcile_repo(rid: str):
    r = repos.get(rid)
    if not r:
        return
    wd = _workdir(rid)
    branch = r["branch"]
    deploy = r.get("authMethod") == "deploykey"
    env = dict(os.environ)
    # Fail fast instead of blocking on an interactive credential/passphrase prompt:
    # in a non-tty container a wrong token or bad key would otherwise hang git/ssh
    # forever and stall the whole reconcile loop.
    env["GIT_TERMINAL_PROMPT"] = "0"
    key_path = None
    if deploy:
        try:
            key_path = vault.repo_deploy_private_tempfile(rid)
        except Exception as e:
            r["error"] = f"deploy key missing from Vault: {e}"
            return
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {key_path} -o IdentitiesOnly=yes -o BatchMode=yes "
            "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
        )
        url = _ssh_url(r["url"])
    else:
        url = _auth_url(r)  # token-in-url or clean

    ok, err = True, ""
    try:
        if os.path.isdir(os.path.join(wd, ".git")):
            f = subprocess.run(["git", "-C", wd, "fetch", "-q", url, branch], capture_output=True, text=True, env=env)
            if f.returncode == 0:
                subprocess.run(["git", "-C", wd, "reset", "--hard", "-q", "FETCH_HEAD"], capture_output=True, env=env)
            else:
                ok, err = False, f.stderr
        else:
            os.makedirs(config.WORKDIR, exist_ok=True)
            res = subprocess.run(["git", "clone", "-q", "--branch", branch, url, wd], capture_output=True, text=True, env=env)
            if res.returncode == 0:
                if not deploy:  # token URL → scrub creds from origin (ssh URLs carry no secret)
                    subprocess.run(["git", "-C", wd, "remote", "set-url", "origin", r["url"]], capture_output=True)
            else:
                ok, err = False, res.stderr
    finally:
        if key_path and os.path.exists(key_path):
            try:
                os.remove(key_path)
            except OSError:
                pass

    if not ok:
        r["error"] = _redact(err.strip()) or "git operation failed"
        print(f"store: reconcile failed for {rid}: {_redact(err.strip())}")
        return
    r.pop("error", None)
    _render_jobs(rid, wd)
    _parse_inventory(rid, wd)
    _install_galaxy_requirements(wd)


_REQ_CANDIDATES = [
    "requirements.yml", "requirements.yaml", "collections/requirements.yml",
    "roles/requirements.yml", "ansible/requirements.yml", "playbooks/requirements.yml",
]


def _install_galaxy_requirements(wd: str):
    """Install repo-declared Ansible collections/roles (if a requirements file
    exists). The base image already bundles common collections."""
    for c in _REQ_CANDIDATES:
        req = os.path.join(wd, c)
        if not os.path.isfile(req):
            continue
        try:
            subprocess.run(["ansible-galaxy", "install", "-r", req], cwd=wd,
                           capture_output=True, text=True, timeout=600)
        except Exception as e:
            print(f"store: ansible-galaxy install failed for {req}: {e}")


_MANIFEST_CANDIDATES = [
    "ansible/jobs.yml", "ansible/jobs.yaml", "jobs.yml", "jobs.yaml",
    "playbooks/ansible/jobs.yml", "playbooks/jobs.yml", "rudder/jobs.yml",
]


def _manifest_entries(data):
    """The job list — either a bare top-level list, or under a `scheduled_jobs`
    / `jobs` key (so both Rudder's and common existing schemas work)."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        v = data.get("scheduled_jobs") or data.get("jobs")
        return v if isinstance(v, list) else []
    return []


def _looks_like_manifest(data) -> bool:
    entries = _manifest_entries(data)
    return bool(entries) and any(
        isinstance(e, dict) and "name" in e and ("playbook" in e or "cron" in e) for e in entries)


def _find_manifest(wd: str):
    """Locate the Rudder job manifest anywhere in the repo. Tries common paths,
    then walks for a jobs.y(a)ml that actually looks like a Rudder manifest."""
    for c in _MANIFEST_CANDIDATES:
        p = os.path.join(wd, c)
        if os.path.isfile(p):
            return p
    cands = []
    for root, dirs, files in os.walk(wd):
        if ".git" in dirs:
            dirs.remove(".git")
        if root[len(wd):].count(os.sep) > 5:
            dirs[:] = []
            continue
        for f in files:
            if f in ("jobs.yml", "jobs.yaml"):
                cands.append(os.path.join(root, f))
    for p in sorted(cands):
        try:
            if _looks_like_manifest(yaml.safe_load(open(p))):
                return p
        except Exception:
            pass
    return None


def _render_jobs(rid: str, wd: str):
    r = repos[rid]
    mpath = _find_manifest(wd)
    found = mpath is not None
    manifest = []
    jobs_yaml = ""
    manifest_dir = ""
    if found:
        manifest_dir = os.path.relpath(os.path.dirname(mpath), wd)
        if manifest_dir == ".":
            manifest_dir = ""
        try:
            manifest = yaml.safe_load(open(mpath)) or []
        except Exception as e:
            print(f"store: manifest parse failed for {rid}: {e}")
            manifest = []
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
        for entry in _manifest_entries(manifest):
            if not isinstance(entry, dict) or "name" not in entry:
                continue
            name = entry["name"]
            jobs[name] = {
                "name": name, "cron": entry.get("cron", "0 0 * * *"),
                "playbook": entry.get("playbook", ""), "limit": entry.get("limit", "all"),
                "kind": entry.get("kind", "task"), "args": entry.get("extra_args"),
                "desc": entry.get("desc", ""),
                "provider": r["provider"], "repoSlug": r["slug"], "branch": r["branch"],
                "_repoId": rid, "_workdir": wd, "_manifestDir": manifest_dir,
            }


def _discover_playbooks(wd: str) -> list:
    out = []
    for root, dirs, files in os.walk(wd):
        if ".git" in dirs:
            dirs.remove(".git")
        for f in files:
            if not f.endswith((".yml", ".yaml")):
                continue
            if _INV_RE.match(f):  # don't list inventory files as playbooks
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
def find_inventory_file(wd: str):
    """Locate the repo's Ansible inventory: common paths, then a shallow walk."""
    for c in _INV_CANDIDATES:
        cand = os.path.join(wd, c)
        if os.path.isfile(cand):
            return cand
        if os.path.isdir(cand):
            for f in sorted(os.listdir(cand)):
                if f.endswith((".ini", ".yml", ".yaml")) or f in ("hosts",):
                    return os.path.join(cand, f)
    for root, dirs, files in os.walk(wd):
        if ".git" in dirs:
            dirs.remove(".git")
        if root[len(wd):].count(os.sep) > 3:
            dirs[:] = []
            continue
        match = next((f for f in sorted(files) if _INV_RE.match(f)), None)
        if match:
            return os.path.join(root, match)
    return None


def _parse_inventory(rid: str, wd: str):
    path = find_inventory_file(wd)
    if not path:
        repo_inventory.pop(rid, None)
        return
    try:
        text = open(path, errors="ignore").read()
    except Exception:
        repo_inventory.pop(rid, None)
        return
    groups_map, hostmap, hostinfo = (
        _parse_yaml_inventory(text) if path.endswith((".yml", ".yaml"))
        else _parse_ini_inventory(text))
    if groups_map or hostmap:
        repo_inventory[rid] = {
            "groups": {g: sorted(hs) for g, hs in groups_map.items() if hs},
            "hostmap": hostmap,
            "hostinfo": hostinfo,
        }
    else:
        repo_inventory.pop(rid, None)


# ── host reachability (real up/down for the Inventory screen) ──
def _probe_one(addr: str, port: int, timeout: float = 2.0) -> bool:
    """A host is 'up' if we can open a TCP connection to its SSH/management port —
    the signal that actually matters for an Ansible control node (ICMP is often
    firewalled and needs extra privileges in a container)."""
    try:
        with socket.create_connection((addr, port), timeout=timeout):
            return True
    except Exception:
        return False


def probe_inventory():
    """Probe every inventory host in parallel and record live up/down. Runs after
    each reconcile and on a short interval; results feed inventory_view()."""
    targets = {}
    for inv in repo_inventory.values():
        for h, info in (inv.get("hostinfo") or {}).items():
            targets.setdefault(h, (info.get("addr") or h, int(info.get("port") or 22)))
    if not targets:
        return
    items = list(targets.items())

    def work(item):
        h, (addr, port) = item
        return h, _probe_one(addr, port)

    with ThreadPoolExecutor(max_workers=min(32, len(items))) as ex:
        results = list(ex.map(work, items))
    now = int(time.time() * 1000)
    with _lock:
        for h, up in results:
            prev = host_reach.get(h) or {}
            host_reach[h] = {"up": up, "lastSeen": now if up else prev.get("lastSeen")}


def _parse_ini_inventory(text: str):
    groups_map: dict = {}
    hostmap: dict = {}
    hostinfo: dict = {}
    cur = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith((";", "#")):
            continue
        if line.startswith("[") and line.endswith("]"):
            name = line[1:-1].strip()
            cur = None if ":" in name else name  # skip [group:vars]/[group:children]
            if cur:
                groups_map.setdefault(cur, set())
            continue
        if cur is None:
            continue
        parts = line.split()
        host = parts[0]
        if "[" in host:  # skip range patterns like web[01:10]
            continue
        groups_map[cur].add(host)
        hostmap.setdefault(host, cur)
        addr, port = host, 22
        for tok in parts[1:]:
            if tok.startswith("ansible_host="):
                addr = tok.split("=", 1)[1]
            elif tok.startswith("ansible_port="):
                try:
                    port = int(tok.split("=", 1)[1])
                except ValueError:
                    pass
        hostinfo.setdefault(host, {"addr": addr, "port": port})
    return groups_map, hostmap, hostinfo


def _parse_yaml_inventory(text: str):
    try:
        data = yaml.safe_load(text) or {}
    except Exception:
        return {}, {}, {}
    groups_map: dict = {}
    hostmap: dict = {}
    hostinfo: dict = {}
    try:
        default_port = int(((data.get("all") or {}).get("vars") or {}).get("ansible_port", 22))
    except (ValueError, TypeError, AttributeError):
        default_port = 22

    def walk(node, gname):
        if not isinstance(node, dict):
            return
        hs = node.get("hosts")
        if isinstance(hs, dict):
            items = list(hs.items())
        elif isinstance(hs, list):
            items = [(h, {}) for h in hs]
        else:
            items = []
        for h, hv in items:
            hv = hv if isinstance(hv, dict) else {}
            groups_map.setdefault(gname, set()).add(h)
            hostmap.setdefault(h, gname)
            addr = str(hv.get("ansible_host") or hv.get("ansible_ssh_host") or h)
            try:
                port = int(hv.get("ansible_port", default_port))
            except (ValueError, TypeError):
                port = default_port
            hostinfo.setdefault(h, {"addr": addr, "port": port})
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
    return groups_map, hostmap, hostinfo


# ── run history (SQLite-backed; in-memory dict is a read cache) ──
def reap_orphaned_runs() -> int:
    """Finalize runs left 'running' by a previous process (pod restart/crash) so
    they don't show 'in progress' forever. Call once at startup, before load_runs."""
    _ensure_migrated()
    try:
        return db.reap_orphaned_runs()
    except Exception as e:
        print("store: reap orphaned runs failed:", e)
        return 0


def load_runs():
    _ensure_migrated()
    try:
        runs.clear()
        runs.update(db.all_runs())
    except Exception as e:
        print("store: load runs failed:", e)


def add_run(name: str, run: dict):
    with _lock:
        runs.setdefault(name, []).insert(0, run)
        runs[name] = runs[name][:db.RUNS_PER_JOB]
        db.insert_run(name, run)


def append_run_log(name: str, run_id: str, entry: dict):
    """Append one classified log line to a running run, so the UI's poll of
    /jobs/{name} shows output live. One row INSERT — not a whole-file rewrite."""
    with _lock:
        for r in runs.get(name, []):
            if r["id"] == run_id:
                r.setdefault("log", []).append(entry)
                r["log"] = r["log"][-400:]
                break
        db.append_log(run_id, entry)


def replace_run(name: str, run_id: str, run: dict):
    with _lock:
        lst = runs.setdefault(name, [])
        for i, r in enumerate(lst):
            if r["id"] == run_id:
                lst[i] = run
                db.update_run(name, run)
                return
        lst.insert(0, run)
        db.insert_run(name, run)


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
        gm = inv.get("groups") or {}
        info = inv.get("hostinfo") or {}
        for g, members in gm.items():
            up = sum(1 for m in members if (host_reach.get(m) or {}).get("up"))
            groups.append({"name": g, "hosts": len(members), "up": up, "desc": "from repo inventory"})
        for h, g in (inv.get("hostmap") or {}).items():
            if h in seen_h:
                continue
            seen_h.add(h)
            r = host_reach.get(h) or {}
            hosts.append({
                "name": h, "group": g,
                "ip": (info.get(h) or {}).get("addr") or "—",
                "os": "—",
                "up": bool(r.get("up", False)),
                "jobs": sum(1 for j in jobs.values() if j.get("limit") in (g, "all")),
                "lastSeen": r.get("lastSeen"),
            })
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


# ── dashboard layout (committed in rudder.yml, read on reconcile) ──
def _norm_widget(w):
    """Normalize one widget's shape. Returns None for junk. Validates structure
    only — the web-ui owns the catalog of known types and skips ones it doesn't
    recognize, so backend and frontend don't duplicate the widget list."""
    if not isinstance(w, dict):
        return None
    t = w.get("type")
    if not isinstance(t, str) or not t.strip():
        return None

    def _i(v, default, lo=0):
        try:
            return max(lo, int(v))
        except (TypeError, ValueError):
            return default

    out = {"type": t.strip(), "x": _i(w.get("x"), 0), "y": _i(w.get("y"), 0),
           "w": _i(w.get("w"), 4, lo=1), "h": _i(w.get("h"), 2, lo=1)}
    m = w.get("metric")
    if isinstance(m, str) and m.strip():
        out["metric"] = m.strip()
    return out


def dashboard_view():
    """Parse the committed `dashboard:` block from rudder.yml (first repo that
    defines one) into a normalized {cols, widgets} layout, or None if absent.

    Never raises: a malformed block yields None so the UI falls back to its
    built-in default layout — a bad commit can't take down the Overview."""
    for m in manifests.values():
        try:
            data = yaml.safe_load(m.get("rudderYaml") or "") or {}
        except Exception:
            continue
        dash = data.get("dashboard") if isinstance(data, dict) else None
        if not isinstance(dash, dict) or not isinstance(dash.get("widgets"), list):
            continue
        widgets = [x for x in (_norm_widget(w) for w in dash["widgets"]) if x]
        if not widgets:
            continue
        try:
            cols = min(24, max(1, int(dash.get("cols", 12))))
        except (TypeError, ValueError):
            cols = 12
        for w in widgets:                       # clamp to the grid width
            w["w"] = min(w["w"], cols)
            w["x"] = min(w["x"], cols - w["w"])
        return {"cols": cols, "widgets": widgets}
    return None
