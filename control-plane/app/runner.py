"""Run an Ansible playbook for a job against the bundled target over SSH.

The SSH private key is pulled from Vault per run (written to a 0600 tempfile and
removed afterwards). Status/duration/exit/log are recorded; metrics + logs are
pushed to Pushgateway and Loki.
"""
import os
import signal
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import alerts, config, log, metrics, store, telemetry, vault


# Live processes, keyed by run_id, so the UI can stop a run mid-flight.
_running: dict = {}
_stopped: set = set()


def stop_run(run_id: str) -> bool:
    """Stop a running playbook. Returns True if a live process was signalled.

    Ansible forks worker + ssh children that inherit the stdout pipe; signalling
    only the parent leaves them holding the pipe open, so the run never finalises.
    We run the playbook in its own process group (start_new_session) and signal the
    whole group, escalating to SIGKILL if it doesn't exit promptly."""
    proc = _running.get(run_id)
    if not proc or proc.poll() is not None:
        return False
    _stopped.add(run_id)
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGTERM)

        def _hard_kill():
            if proc.poll() is None:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

        threading.Timer(5, _hard_kill).start()
    except ProcessLookupError:
        proc.kill()
    return True


def _ssh_args() -> str:
    """SSH options for Ansible. Trust-on-first-use against a persisted known_hosts
    by default (MITM-safe after first contact), or strict if SSH_STRICT is set —
    instead of the old blanket StrictHostKeyChecking=no that trusted any host."""
    mode = "yes" if store.settings["sshStrict"] else "accept-new"
    kh = config.SSH_KNOWN_HOSTS
    try:
        os.makedirs(os.path.dirname(kh), exist_ok=True)
        open(kh, "a").close()
    except OSError:
        pass
    return f"-o StrictHostKeyChecking={mode} -o UserKnownHostsFile={kh} -o ConnectTimeout=15"


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

    prev_status = (store.runs.get(name) or [{}])[0].get("status")   # for recovery detection
    run_id = f"{name}-{int(time.time() * 1000)}"
    log.info("run started", run_id=run_id, job=name, manual=manual, host=target_label)
    store.add_run(name, {
        "id": run_id, "at": int(time.time() * 1000), "status": "running",
        "duration": None, "exit": None, "host": target_label, "streaming": True,
        "log": [{"t": "play", "text": f"PLAY [{j['limit']}] — starting…"}],
    })

    started = time.time()
    key_path = inv_tempfile = vp_path = None
    cwd = None
    log_lines = []
    timed_out = False
    exit_code = 1
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
            ANSIBLE_HOST_KEY_CHECKING="True",
            ANSIBLE_RETRY_FILES_ENABLED="False",
            ANSIBLE_SSH_ARGS=_ssh_args(),
        )
        if vp_path:
            # override ansible.cfg's vault_password_file (often an operator's local path)
            env["ANSIBLE_VAULT_PASSWORD_FILE"] = vp_path
        # Force unbuffered, line-by-line Ansible output so we can stream it live.
        env["PYTHONUNBUFFERED"] = "1"

        # Stream stdout (with stderr merged in) line-by-line, appending each line
        # to the run's log so the UI's poll shows progress as it happens.
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=env, cwd=cwd,
            start_new_session=True,   # own process group, so stop_run can kill ssh children too
        )

        def _on_timeout():
            nonlocal timed_out
            timed_out = True
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)   # whole group, incl. ssh children
            except (ProcessLookupError, OSError):
                proc.kill()

        _running[run_id] = proc
        timer = None
        run_timeout = store.settings["runTimeoutSeconds"]
        if run_timeout > 0:
            timer = threading.Timer(run_timeout, _on_timeout)
            timer.start()
        try:
            for line in proc.stdout:
                ln = line.rstrip("\n")
                if not ln.strip():
                    continue
                entry = {"t": _classify(ln), "text": ln}
                log_lines.append(entry)
                store.append_run_log(name, run_id, entry)
            proc.wait()
        finally:
            if timer:
                timer.cancel()

        if timed_out:
            log_lines.append({"t": "err", "text": f"control-plane: playbook timed out ({run_timeout}s)"})
            exit_code = 124
        elif run_id in _stopped:
            _stopped.discard(run_id)
            log_lines.append({"t": "err", "text": "■ run stopped by operator"})
            exit_code = 130
        else:
            exit_code = proc.returncode
    except Exception as e:
        log_lines.append({"t": "err", "text": f"control-plane error: {e}"})
        exit_code = 1
    finally:
        _running.pop(run_id, None)
        for p in (key_path, inv_tempfile, vp_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass

    duration = int(time.time() - started)
    status = "success" if exit_code == 0 else "failed"
    out = "\n".join(e["text"] for e in log_lines)
    tail = log_lines[-400:] or [{"t": "task", "text": "(no output)"}]
    store.replace_run(name, run_id, {
        "id": run_id, "at": int(time.time() * 1000), "status": status,
        "duration": duration, "exit": exit_code, "host": target_label, "log": tail,
    })
    telemetry.push_metrics(name, status == "success", exit_code, duration)
    telemetry.push_logs(name, status, out)
    metrics.record_run(status, duration)
    log.info("run finished", run_id=run_id, job=name, status=status, exit=exit_code, duration=duration)
    alerts.dispatch(name, status, prev_status, {"exit": exit_code, "host": target_label,
                                                "at": int(time.time() * 1000)})
    return status


class QueueFull(Exception):
    """Raised when too many runs are already in flight (→ HTTP 429)."""


class AlreadyRunning(Exception):
    """Raised when a run for this job is already queued/running (→ HTTP 409)."""


# Bounded pool replaces unbounded daemon threads: a network-reachable /run
# endpoint could otherwise spawn threads (each a full Ansible-over-SSH process)
# without limit and OOM the pod. RUN_WORKERS bounds concurrency; RUN_QUEUE_MAX
# bounds total in-flight; single-flight per job prevents overlapping runs.
_pool = ThreadPoolExecutor(max_workers=config.RUN_WORKERS)
_inflight: dict = {}                 # name -> Future (queued or running)
_inflight_lock = threading.Lock()


def run_async(name: str, manual: bool = True):
    with _inflight_lock:
        cur = _inflight.get(name)
        if cur is not None and not cur.done():
            raise AlreadyRunning(name)
        active = sum(1 for f in _inflight.values() if not f.done())
        if active >= store.settings["runQueueMax"]:
            raise QueueFull()
        fut = _pool.submit(run_job, name, manual)
        _inflight[name] = fut

    def _cleanup(f, n=name):
        # Surface any exception raised inside run_job: a ThreadPoolExecutor future
        # swallows it until .result() is called, so without this a crash in the
        # runner looks like "submitted 200 OK but nothing ever happened".
        try:
            exc = f.exception()
        except Exception:
            exc = None
        if exc is not None:
            log.error("run crashed", job=n, error=repr(exc))
        with _inflight_lock:
            if _inflight.get(n) is f:
                _inflight.pop(n, None)

    fut.add_done_callback(_cleanup)
    return fut


def active_count() -> int:
    """Runs currently queued or executing (for /metrics + /readyz)."""
    with _inflight_lock:
        return sum(1 for f in _inflight.values() if not f.done())


def apply_workers(n: int):
    """Resize the run pool when settings.runWorkers changes — but only while the
    pool is idle, since a ThreadPoolExecutor can't be resized in place and doing
    it mid-run would disrupt in-flight work. If busy, a later reconcile re-applies."""
    global _pool
    try:
        if n == _pool._max_workers or active_count() > 0:
            return
        old, _pool = _pool, ThreadPoolExecutor(max_workers=n)
        old.shutdown(wait=False)
        log.info("run pool resized", workers=n)
    except Exception as e:
        log.error("run pool resize failed", error=repr(e))


def shutdown():
    """Graceful stop: signal in-flight runs to terminate and stop the pool so a
    pod SIGTERM doesn't orphan ansible-playbook children or corrupt run state."""
    for run_id in list(_running.keys()):
        try:
            stop_run(run_id)
        except Exception:
            pass
    try:
        _pool.shutdown(wait=False, cancel_futures=True)
    except TypeError:                          # cancel_futures added in 3.9
        _pool.shutdown(wait=False)


def submit_scheduled(name: str):
    """Scheduler entrypoint: go through the same pool, but skip (don't raise) if
    the job is already running or the queue is saturated."""
    try:
        run_async(name, manual=False)
    except AlreadyRunning:
        print(f"runner: scheduled run of {name} skipped — already running")
    except QueueFull:
        print(f"runner: scheduled run of {name} skipped — run queue full")
