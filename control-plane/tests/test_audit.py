"""Audit trail: records mutations append-only with principal + source IP."""
import pytest

from app import audit, auth, config, db


@pytest.fixture
def freshdb(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_FILE", str(tmp_path / "rudder.db"))
    db.reset()
    yield
    db.reset()


class _Req:
    def __init__(self, ip, fwd=None):
        self.client = type("C", (), {"host": ip})()
        self.headers = {"x-forwarded-for": fwd} if fwd else {}


def test_record_and_read(freshdb):
    p = auth.Principal("alice@corp.com", auth.Role.operator)
    audit.record(p, "job.run", "weekly-patch", _Req("10.0.0.5"))
    audit.record(p, "repo.remove", "github:a/b", _Req("1.2.3.4"))
    rows = audit.recent()
    assert len(rows) == 2
    assert rows[0]["action"] == "repo.remove"        # newest first
    assert rows[1]["action"] == "job.run"
    assert rows[1]["principal"] == "alice@corp.com"
    assert rows[1]["role"] == "operator"
    assert rows[1]["source_ip"] == "10.0.0.5"


def test_source_ip_prefers_forwarded_for(freshdb):
    audit.record(auth.Principal("x", auth.Role.admin), "reconcile", "", _Req("172.16.0.1", fwd="203.0.113.9, 10.0.0.1"))
    assert audit.recent()[0]["source_ip"] == "203.0.113.9"
