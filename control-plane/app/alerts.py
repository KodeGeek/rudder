"""Notification dispatch on run completion.

Channels are declared in each repo's rudder.yml `alerts:` list (parsed by the
store into {type, target, on, jobs?}). On every finished run we compute the
event (failed / success / recovery) and fan it out to the channels whose `on`
list matches. Handlers: generic webhook (JSON), Slack/Teams incoming webhooks,
and `log`. Sending never raises into the run path.
"""
import requests

from . import store


def _event(status: str, prev_status) -> str:
    if status == "failed":
        return "failed"
    if status == "success":
        return "recovery" if prev_status == "failed" else "success"
    return status


def _payload(ch: dict, job: str, status: str, event: str, run: dict) -> dict:
    text = (f"Rudder · job *{job}* {event} "
            f"(status={status}, exit={run.get('exit')}, host={run.get('host')})")
    t = ch.get("type")
    if t in ("slack", "teams"):
        return {"text": text}
    return {                                    # generic webhook
        "job": job, "status": status, "event": event,
        "exit": run.get("exit"), "host": run.get("host"), "at": run.get("at"), "text": text,
    }


def _send(ch: dict, payload: dict) -> bool:
    if ch.get("type") == "log":
        print("alert:", payload.get("text") or payload)
        return True
    url = ch.get("target") or ""
    if not url.startswith("http"):
        print("alert: channel", ch.get("label"), "has no usable target")
        return False
    requests.post(url, json=payload, timeout=6)
    return True


def dispatch(job: str, status: str, prev_status, run: dict) -> dict:
    """Fan a finished run out to matching channels. Returns a small summary."""
    event = _event(status, prev_status)
    sent = 0
    for ch in list(store.channels):
        if not ch.get("enabled", True):
            continue
        jobs_filter = ch.get("jobs")
        if jobs_filter and job not in jobs_filter:
            continue
        on = ch.get("on") or []
        # a "recovery" also satisfies channels that asked for "success"
        if event in on or (event == "recovery" and "success" in on):
            try:
                if _send(ch, _payload(ch, job, status, event, run)):
                    sent += 1
            except Exception as e:
                print("alert: send to", ch.get("label"), "failed:", e)
    return {"event": event, "sent": sent}


def test_channel(ch: dict) -> bool:
    """Send a one-off test notification to a single channel (UI 'Test' button)."""
    payload = _payload(ch, "test-job", "success", "test", {"exit": 0, "host": "—", "at": 0})
    payload["text"] = "Rudder test notification ✅"
    return _send(ch, payload)
