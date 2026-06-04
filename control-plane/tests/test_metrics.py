"""Control-plane self-metrics render and the /metrics endpoint is open + 200."""
from fastapi.testclient import TestClient

from app import main, metrics


def test_render_contains_rudder_metrics():
    metrics.record_run("success", 12)
    metrics.record_run("failed", 3)
    metrics.record_reconcile(True, 1.5)
    text = metrics.render()[0].decode()
    assert 'rudder_runs_total{status="success"}' in text
    assert "rudder_reconcile_duration_seconds" in text


def test_metrics_endpoint_is_open_and_200():
    # vault is unreachable under test → vault_up=0, must not error the scrape.
    r = TestClient(main.app).get("/metrics")
    assert r.status_code == 200
    assert "rudder_scheduler_running" in r.text
    assert "rudder_jobs_total" in r.text
