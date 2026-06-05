"""SQLite persistence: round-trips, the run-log storm fix, 50-run cap, JSON migration."""
import json
import os

import pytest

from app import config, db, store


@pytest.fixture
def freshdb(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_FILE", str(tmp_path / "rudder.db"))
    monkeypatch.setattr(config, "STATE_FILE", str(tmp_path / "repos.json"))
    monkeypatch.setattr(config, "RUNS_FILE", str(tmp_path / "runs.json"))
    db.reset()
    store._migrated = False
    store.repos.clear()
    store.runs.clear()
    store.jobs.clear()
    yield tmp_path
    db.reset()


def _run(rid, at, status="running", log=None):
    return {"id": rid, "at": at, "status": status, "duration": None,
            "exit": None, "host": "h", "streaming": True, "log": log or []}


def test_repos_roundtrip(freshdb):
    store.repos["github:a/b"] = {"id": "github:a/b", "url": "x", "error": "transient"}
    store.save_repos()
    got = {r["id"]: r for r in db.all_repos()}
    assert "github:a/b" in got
    assert "error" not in got["github:a/b"]   # transient field is stripped on save


def test_append_log_is_row_insert_not_rewrite(freshdb):
    # A chatty run must not rewrite a whole blob per line — assert one run row,
    # many ordered log rows, growing by exactly one per append.
    store.add_run("job1", _run("r1", 1000, log=[{"t": "play", "text": "starting"}]))
    c = db.conn()
    assert c.execute("SELECT COUNT(*) AS n FROM runs").fetchone()["n"] == 1
    assert c.execute("SELECT COUNT(*) AS n FROM run_logs").fetchone()["n"] == 1
    for i in range(200):
        before = c.execute("SELECT COUNT(*) AS n FROM run_logs").fetchone()["n"]
        store.append_run_log("job1", "r1", {"t": "ok", "text": "line %d" % i})
        after = c.execute("SELECT COUNT(*) AS n FROM run_logs").fetchone()["n"]
        assert after == before + 1
    assert c.execute("SELECT COUNT(*) AS n FROM runs").fetchone()["n"] == 1   # still one run
    texts = [r["text"] for r in c.execute(
        "SELECT text FROM run_logs WHERE run_id='r1' ORDER BY id ASC").fetchall()]
    assert texts[0] == "starting" and texts[1] == "line 0" and texts[-1] == "line 199"


def test_fifty_run_cap(freshdb):
    for i in range(60):
        store.add_run("job1", _run("r%d" % i, 1000 + i, status="success"))
    assert db.conn().execute(
        "SELECT COUNT(*) AS n FROM runs WHERE job='job1'").fetchone()["n"] == db.RUNS_PER_JOB
    kept = {r["id"] for r in db.conn().execute("SELECT id FROM runs").fetchall()}
    assert "r59" in kept and "r0" not in kept                 # newest kept, oldest pruned


def test_replace_run_finalizes_without_duplicate_logs(freshdb):
    store.add_run("job1", _run("r1", 1000, log=[{"t": "play", "text": "starting"}]))
    for i in range(5):
        store.append_run_log("job1", "r1", {"t": "ok", "text": "stream %d" % i})
    final = _run("r1", 1000, status="success",
                 log=[{"t": "ok", "text": "stream %d" % i} for i in range(5)])
    final["exit"] = 0
    store.replace_run("job1", "r1", final)
    rows = db.conn().execute(
        "SELECT text FROM run_logs WHERE run_id='r1' ORDER BY id ASC").fetchall()
    assert [r["text"] for r in rows] == ["stream 0", "stream 1", "stream 2", "stream 3", "stream 4"]
    meta = db.conn().execute("SELECT status, exit FROM runs WHERE id='r1'").fetchone()
    assert meta["status"] == "success" and meta["exit"] == 0


def test_load_runs_rebuilds_cache_newest_first(freshdb):
    store.add_run("job1", _run("r1", 1000, status="success", log=[{"t": "ok", "text": "a"}]))
    store.add_run("job1", _run("r2", 2000, status="failed", log=[{"t": "err", "text": "b"}]))
    store.runs.clear()
    store.load_runs()
    assert [r["id"] for r in store.runs["job1"]] == ["r2", "r1"]   # newest first
    assert store.runs["job1"][0]["log"] == [{"t": "err", "text": "b"}]


def test_json_migration_imports_and_retires_files(freshdb):
    json.dump([{"id": "github:a/b", "url": "x"}], open(config.STATE_FILE, "w"))
    json.dump({"job1": [_run("r1", 1000, status="success", log=[{"t": "ok", "text": "a"}])]},
              open(config.RUNS_FILE, "w"))
    store.load_repos()
    store.load_runs()
    assert "github:a/b" in store.repos
    assert store.runs["job1"][0]["id"] == "r1"
    assert store.runs["job1"][0]["log"] == [{"t": "ok", "text": "a"}]
    assert not os.path.exists(config.STATE_FILE) and os.path.exists(config.STATE_FILE + ".imported")
    assert not os.path.exists(config.RUNS_FILE) and os.path.exists(config.RUNS_FILE + ".imported")


def test_reap_orphaned_runs_finalizes_stuck_running(freshdb):
    # Simulate a process restart: a run left 'running' in the DB with no live process.
    store.add_run("job1", _run("r1", 1000, status="running", log=[{"t": "play", "text": "starting"}]))
    store.add_run("job1", _run("r2", 2000, status="success"))   # a healthy completed run
    reaped = store.reap_orphaned_runs()
    assert reaped == 1
    rows = {r["id"]: r for r in db.conn().execute(
        "SELECT id, status, exit, streaming FROM runs").fetchall()}
    assert rows["r1"]["status"] == "failed" and rows["r1"]["exit"] == 137 and rows["r1"]["streaming"] == 0
    assert rows["r2"]["status"] == "success"                    # untouched
    # the embedded JSON blob is updated too (UI reads it), and an interrupt note is logged
    meta = json.loads(db.conn().execute("SELECT json FROM runs WHERE id='r1'").fetchone()["json"])
    assert meta["status"] == "failed" and meta["streaming"] is False
    last = db.conn().execute(
        "SELECT text FROM run_logs WHERE run_id='r1' ORDER BY id DESC LIMIT 1").fetchone()["text"]
    assert "interrupted" in last
    assert store.reap_orphaned_runs() == 0                      # idempotent: nothing left running


def test_job_view_shape_unchanged(freshdb):
    store.jobs["job1"] = {
        "name": "job1", "cron": "0 3 * * *", "playbook": "p.yml", "limit": "all",
        "kind": "task", "provider": "github", "repoSlug": "a/b", "branch": "main",
    }
    store.add_run("job1", _run("r1", 1000, status="success", log=[{"t": "ok", "text": "a"}]))
    v = store.job_view("job1", next_ms=None, with_runs=True)
    assert v["status"] == "ok" and v["successRate"] == 100
    assert v["runs"][0]["id"] == "r1" and v["runs"][0]["log"] == [{"t": "ok", "text": "a"}]
