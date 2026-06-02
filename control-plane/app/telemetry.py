"""Push run metrics to Pushgateway/Prometheus and run logs to Loki."""
import time

import requests
from prometheus_client import CollectorRegistry, Gauge, push_to_gateway

from . import config


def _gateway_host() -> str:
    return config.PUSHGATEWAY_URL.replace("https://", "").replace("http://", "").rstrip("/")


def push_metrics(task: str, success: bool, exit_code, duration: int):
    """One series per job, labelled task="<name>" (§5.2)."""
    try:
        reg = CollectorRegistry()
        g_success = Gauge("ansible_job_last_success", "1 = ok, 0 = failed", ["task"], registry=reg)
        g_exit = Gauge("ansible_job_last_exit_code", "process exit code", ["task"], registry=reg)
        g_dur = Gauge("ansible_job_duration_seconds", "last run duration", ["task"], registry=reg)
        g_ts = Gauge("ansible_job_last_run_timestamp_seconds", "unix seconds of last run", ["task"], registry=reg)
        g_success.labels(task).set(1 if success else 0)
        g_exit.labels(task).set(exit_code if exit_code is not None else -1)
        g_dur.labels(task).set(duration)
        g_ts.labels(task).set(time.time())
        push_to_gateway(_gateway_host(), job="ansible-cron", registry=reg, grouping_key={"task": task})
    except Exception as e:  # never let telemetry break a run
        print("telemetry: metrics push failed:", e)


def push_logs(task: str, status: str, stdout: str):
    """Ship the run log tail to Loki under {job, task, status} labels (§5.3)."""
    try:
        lines = [ln for ln in stdout.splitlines() if ln.strip()] or ["(no output)"]
        base = int(time.time() * 1e9)
        values = [[str(base + i), ln] for i, ln in enumerate(lines)]
        payload = {"streams": [{
            "stream": {"job": "ansible-cron", "task": task, "status": status},
            "values": values,
        }]}
        requests.post(config.LOKI_URL + "/loki/api/v1/push", json=payload, timeout=4)
    except Exception as e:
        print("telemetry: loki push failed:", e)
