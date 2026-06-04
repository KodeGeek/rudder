"""Notification dispatch: event detection + channel routing (with sends stubbed)."""
import pytest

from app import alerts, store


@pytest.fixture
def captured(monkeypatch):
    sent = []
    monkeypatch.setattr(alerts, "_send", lambda ch, payload: (sent.append((ch.get("label"), payload)) or True))
    store.channels.clear()
    yield sent
    store.channels.clear()


def test_event_detection():
    assert alerts._event("failed", "success") == "failed"
    assert alerts._event("success", "failed") == "recovery"
    assert alerts._event("success", "success") == "success"


def test_failed_routes_only_to_failure_channels(captured):
    store.channels.extend([
        {"label": "ops", "type": "webhook", "target": "http://x", "on": ["failed"], "enabled": True},
        {"label": "noise", "type": "webhook", "target": "http://y", "on": ["success"], "enabled": True},
    ])
    r = alerts.dispatch("job1", "failed", "success", {"exit": 2})
    assert r["event"] == "failed" and r["sent"] == 1
    assert [c[0] for c in captured] == ["ops"]


def test_recovery_also_satisfies_success_channels(captured):
    store.channels.append({"label": "ok", "type": "slack", "target": "http://s", "on": ["success"], "enabled": True})
    r = alerts.dispatch("job1", "success", "failed", {"exit": 0})
    assert r["event"] == "recovery" and r["sent"] == 1


def test_jobs_filter_scopes_channel(captured):
    store.channels.append({"label": "only-a", "type": "webhook", "target": "http://x",
                           "on": ["failed"], "enabled": True, "jobs": ["jobA"]})
    assert alerts.dispatch("jobB", "failed", None, {})["sent"] == 0
    assert alerts.dispatch("jobA", "failed", None, {})["sent"] == 1


def test_disabled_channel_skipped(captured):
    store.channels.append({"label": "off", "type": "webhook", "target": "http://x", "on": ["failed"], "enabled": False})
    assert alerts.dispatch("job1", "failed", None, {})["sent"] == 0


def test_slack_payload_shape():
    ch = {"type": "slack", "target": "http://s"}
    p = alerts._payload(ch, "job1", "failed", "failed", {"exit": 1, "host": "h"})
    assert set(p.keys()) == {"text"} and "job1" in p["text"]
