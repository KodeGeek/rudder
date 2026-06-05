# Rudder Operations Runbook

Operational guide for running Rudder in production. Pairs with the Prometheus
alert rules shipped in `deploy/k8s/30-prometheus.yaml` (and the Helm chart).

## Health surfaces

| Surface | Where | Meaning |
|---|---|---|
| `GET /healthz` | control-plane :8090 | process is up (liveness) |
| `GET /readyz` | control-plane :8090 | scheduler running + booted (readiness; gates traffic) |
| `GET /metrics` | control-plane :8090 | self-metrics (`rudder_*`) scraped by Prometheus |
| Run logs | UI → job → Live run, and Loki | per-run Ansible output |
| Structured logs | pod stdout (JSON lines) | run/reconcile lifecycle events with `run_id` |

## Alerts → response

### RudderControlPlaneDown (critical)
Prometheus can't scrape `control-plane:8090`.
1. `kubectl -n rudder get pods -l app.kubernetes.io/name=control-plane`
2. `kubectl -n rudder logs deploy/control-plane --tail=100`
3. Common causes: PVC not bound (see *PVC Pending* below), Vault sealed (startup
   probe never passes), OOMKilled (check `kubectl describe`, raise memory limit).

### RudderVaultDown (critical)
`rudder_vault_up == 0` — Vault unreachable or sealed. Runs that need secrets fail.
1. `kubectl -n rudder get pods -l app.kubernetes.io/name=vault` (expect 2/2 — server + unseal sidecar)
2. `kubectl -n rudder logs deploy/vault -c unseal` — the sidecar auto-unseals; if it
   crashlooped, restart: `kubectl -n rudder rollout restart deploy/vault`.
3. Vault data persists on the `vault-data` PVC; unseal keys/root token on `vault-shared`.

### RudderReconcileStalled (warning)
No reconcile in over an hour — the schedule may be stale vs Git.
1. Check logs for `reconcile complete` JSON events and any clone/auth errors.
2. Force one: `POST /reconcile` (UI: **Reconcile now**).
3. If a repo's token/deploy-key expired, re-set it in Settings → Credentials.

### RudderJobFailing (warning)
A job's last run failed (`ansible_job_last_success == 0`).
1. UI → the job → Live run for the failure output; or query Loki
   `{job="ansible-cron", task="<name>"}`.
2. Reproduce with **Run now**; inspect the **Playbook** tab to confirm intent.
3. SSH host-key changes show as connection failures — see *SSH host-key* below.

## Common incidents

**PVC Pending.** No default StorageClass on the cluster. Set
`persistence.storageClassName` (Helm) to the cluster's class. `kubectl get sc`.

**SSH host-key rejected.** Rudder pins host keys (trust-on-first-use) in
`/app/work/known_hosts`. If a managed host was rebuilt, its key changed and runs
fail. Remove the stale entry (exec the pod, edit the file) or, if you trust the
change, the next first-contact re-pins. `SSH_STRICT=true` disables auto-pinning.

**Run queue full (HTTP 429).** Too many concurrent runs. Raise `RUN_WORKERS` /
`RUN_QUEUE_MAX`, or wait. `rudder_runs_active` shows current depth.

**Run stuck "running" after a pod restart.** A run interrupted by a crash stays
"running" until pruned (50-run cap) — it did not complete. Re-trigger it.

## Backups & restore

State lives in SQLite on the `cp-work` PVC (`/app/work/rudder.db`), with secrets
in Vault on `vault-data`. To back up: snapshot the PVCs, or copy the DB:

```bash
kubectl -n rudder exec deploy/control-plane -- \
  sh -c 'sqlite3 /app/work/rudder.db ".backup /app/work/backup.db"'
kubectl -n rudder cp rudder/<pod>:/app/work/backup.db ./rudder-backup.db
```

Restore by copying a `rudder.db` back to `/app/work` and restarting the pod.
Prometheus + Loki remain the durable long-term record of metrics and run logs.

## Upgrades

Images use unique tags (kustomize playbook) or chart `image.tag`. Roll with
`kubectl -n rudder rollout restart deploy/control-plane` or `helm upgrade`.
`terminationGracePeriodSeconds: 40` lets in-flight runs drain on shutdown.
