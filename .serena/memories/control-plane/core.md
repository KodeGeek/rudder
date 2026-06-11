# control-plane — Core

FastAPI app; entry `app/main.py` (auth guards all routes; APScheduler started here).

## Module map (app/)
- store.py — in-memory state (repos/jobs/runs/inventory) + SQLite WAL persistence; single-writer via `_lock`
- runner.py — Ansible execution: SSH private key fetched from Vault per run → 0600 tempfile, deleted right after; bounded worker pool (default 4); logs streamed line-by-line
- vault.py — hvac client (OpenBao): SSH keypair, ansible-vault password, git token
- auth.py — API-key auth + RBAC roles admin/operator/viewer
- config.py — all env parsing · db.py — SQLite schema (repos, runs, run_logs, audit)
- host.py — TCP reachability probe with downAfter consecutive-fail hysteresis (anti-flap)
- gitea.py (bundled repo seeding) · alerts.py (slack/teams/webhook/log) · metrics.py + telemetry.py (Pushgateway + Loki push) · audit.py (append-only log)

## Runtime invariants
- Reconcile loop: pull repo → parse jobs.yml + rudder.yml → regenerate APScheduler cron jobs + apply runtime settings. Default interval 120s; manual trigger exists.
- jobs.yml entry: name, cron, playbook, limit, kind: task|dsc, desc, optional args. Manifest may live at repo root or ansible/; playbook paths resolve relative to manifest dir with repo-root fallback.
- rudder.yml `settings:` keys: reconcileSeconds, runWorkers, runQueueMax, runTimeoutSeconds, sshStrict, reachability{intervalSeconds, timeoutSeconds, attempts, downAfter}; plus `alerts:` and `dashboard:` blocks. All optional; invalid values silently ignored, defaults kept.
- Backpressure: POST /run returns 429 once in-flight (queued+running) ≥ runQueueMax.
- Max one in-flight run per job; misfire_grace_time 60s absorbs clock skew.
- Run metadata + 400-line tail kept in SQLite; every log line also pushed to Loki immediately (no buffering).
- SSH trust-on-first-use by default (host key pinned on first contact); sshStrict/SSH_STRICT=true requires pre-populated known_hosts.