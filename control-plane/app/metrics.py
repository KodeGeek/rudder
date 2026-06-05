"""Control-plane self-observability — Prometheus metrics about Rudder itself
(not the Ansible jobs, which telemetry.py pushes). Scraped at GET /metrics.

Event metrics (counters/histograms) are updated as things happen; the snapshot
gauges (scheduler/jobs/repos/active/vault) are set by the /metrics handler at
scrape time, where it has access to the live objects.
"""
import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

# ── snapshot gauges (set at scrape time) ──
scheduler_running = Gauge("rudder_scheduler_running", "1 if the job scheduler is running")
jobs_total = Gauge("rudder_jobs_total", "number of scheduled jobs")
repos_total = Gauge("rudder_repos_total", "number of connected repos")
runs_active = Gauge("rudder_runs_active", "runs currently queued or executing")
vault_up = Gauge("rudder_vault_up", "1 if Vault is reachable and unsealed")
reconcile_last = Gauge("rudder_reconcile_last_timestamp_seconds", "unix time of the last reconcile")

# ── event metrics ──
runs_total = Counter("rudder_runs_total", "completed runs by status", ["status"])
run_duration = Histogram("rudder_run_duration_seconds", "run duration",
                         buckets=(5, 15, 30, 60, 120, 300, 600, 1800))
reconcile_total = Counter("rudder_reconcile_total", "reconcile attempts by result", ["result"])
reconcile_duration = Histogram("rudder_reconcile_duration_seconds", "reconcile duration",
                               buckets=(0.5, 1, 2, 5, 10, 30, 60, 120))


def record_run(status: str, duration):
    runs_total.labels(status).inc()
    if duration is not None:
        run_duration.observe(duration)


def record_reconcile(ok: bool, duration: float):
    reconcile_total.labels("success" if ok else "failure").inc()
    reconcile_duration.observe(duration)
    reconcile_last.set(time.time())


def render():
    return generate_latest(), CONTENT_TYPE_LATEST
