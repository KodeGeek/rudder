"""Run an Ansible playbook for a job against the bundled target over SSH.

The SSH private key is pulled from Vault per run (written to a 0600 tempfile and
removed afterwards). Status/duration/exit/log are recorded; metrics + logs are
pushed to Pushgateway and Loki.
"""
import os
import subprocess
import tempfile
import threading
import time

from . import config, store, telemetry, vault


def _classify(line: str) -> str:
    s = line.strip()
    if s.startswith("PLAY RECAP"):
        return "recap"
    if s.startswith("PLAY ["):
        return "play"
    if s.startswith("TASK ["):
        return "task"
    if s.startswith("ok:"):
        return "ok"
    if s.startswith("changed:"):
        return "chg"
    if s.startswith(("fatal:", "failed:", "FAILED", "ERROR", "unreachable:")):
        return "err"
    return "task"


def _inventory(limit: str):
    grp = limit if limit and limit != "all" else "all_hosts"
    fd, path = tempfile.mkstemp(prefix="rudder_inv_", suffix=".ini")
    content = (
        f"[{grp}]\n"
        f"{config.TARGET_HOST} ansible_host={config.TARGET_HOST} "
        f"ansible_user={config.TARGET_USER} ansible_port={config.TARGET_PORT}\n\n"
        f"[{grp}:vars]\n"
        f"ansible_python_interpreter=auto_silent\n"
    )
    with os.fdopen(fd, "w") as f:
        f.write(content)
    return path, grp


def _resolve_playbook(j: dict) -> str:
    """Resolve the playbook path relative to the repo root, falling back to the
    manifest's directory (manifests aren't always at the repo root)."""
    wd, pb = j["_workdir"], j.get("playbook", "")
    cand = os.path.join(wd, pb)
    if os.path.exists(cand):
        return cand
    md = j.get("_manifestDir", "")
    if md:
        alt = os.path.join(wd, md, pb)
        if os.path.exists(alt):
            return alt
    return cand


def run_job(name: str, manual: bool = False):
    j = store.jobs.get(name)
    if not j:
        return None

    rid = j.get("_repoId", "")
    wd = j["_workdir"]
    real_inv = store.find_inventory_file(wd)            # the repo's real inventory, if any
    target_label = (j.get("limit") or "fleet") if real_inv else config.TARGET_HOST

    run_id = f"{name}-{int(time.time() * 1000)}"
    store.add_run(name, {
        "id": run_id, "at": int(time.time() * 1000), "status": "running",
        "duration": None, "exit": None, "host": target_label, "streaming": True,
        "log": [{"t": "play", "text": f"PLAY [{j['limit']}] — starting…"}],
    })

    started = time.time()
    key_path = inv_tempfile = vp_path = None
    cwd = None
    try:
        # SSH key: the operator's fleet key if configured for this repo, else
        # Rudder's bundled run key (for the demo target).
        host_key = None
        try:
            host_key = vault.repo_host_key_tempfile(rid)
        except Exception:
            host_key = None
        key_path = host_key or vault.private_key_tempfile()
        # ansible-vault password (decrypts encrypted vars), if configured.
        try:
            vp_path = vault.repo_vault_pass_tempfile(rid)
        except Exception:
            vp_path = None

        if real_inv:
            inv_arg, cwd, playbook = real_inv, wd, j["playbook"]    # run from repo root
        else:
            inv_tempfile, grp = _inventory(j["limit"])
            inv_arg, playbook = inv_tempfile, _resolve_playbook(j)

        cmd = ["ansible-playbook", playbook, "-i", inv_arg, "--private-key", key_path]
        lim = j.get("limit") or ""
        if real_inv:
            # Inventories/group_vars commonly hard-code ansible_ssh_private_key_file to an
            # operator-local path (e.g. ~/.../Certs/key). --private-key is low precedence and
            # loses to that. Force Rudder's Vault-provided key via extra-vars (highest
            # precedence) so the run key actually reaches the fleet.
            cmd += ["-e", f"ansible_ssh_private_key_file={key_path}"]
            if lim and lim != "all":
                cmd += ["--limit", lim]      # else: the playbook's own hosts: scopes it
        else:
            cmd += ["--limit", (lim if lim and lim != "all" else grp)]
        if j.get("args"):
            cmd += str(j["args"]).split()

        env = dict(
            os.environ,
            ANSIBLE_HOST_KEY_CHECKING="False",
            ANSIBLE_RETRY_FILES_ENABLED="False",
            ANSIBLE_SSH_ARGS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15",
        )
        if vp_path:
            # override ansible.cfg's vault_password_file (often an operator's local path)
            env["ANSIBLE_VAULT_PASSWORD_FILE"] = vp_path
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, env=env, cwd=cwd)
        out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        out, exit_code = "control-plane: playbook timed out (30m)", 124
    except Exception as e:
        out, exit_code = f"control-plane error: {e}", 1
    finally:
        for p in (key_path, inv_tempfile, vp_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass

    duration = int(time.time() - started)
    status = "success" if exit_code == 0 else "failed"
    log = [{"t": _classify(ln), "text": ln} for ln in out.splitlines() if ln.strip()][:400] \
        or [{"t": "task", "text": "(no output)"}]
    store.replace_run(name, run_id, {
        "id": run_id, "at": int(time.time() * 1000), "status": status,
        "duration": duration, "exit": exit_code, "host": target_label, "log": log,
    })
    telemetry.push_metrics(name, status == "success", exit_code, duration)
    telemetry.push_logs(name, status, out)
    return status


def run_async(name: str, manual: bool = True):
    threading.Thread(target=run_job, args=(name,), kwargs={"manual": manual}, daemon=True).start()
