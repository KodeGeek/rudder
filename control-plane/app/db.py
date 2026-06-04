"""SQLite (WAL) persistence for repos, run metadata, and run logs.

Why SQLite instead of the previous JSON files: run logs stream in line-by-line,
and the old `append_run_log` rewrote the *entire* runs file on every line under a
global lock — a corruption and throughput hazard. Here a log line is a single row
INSERT, run metadata is one row, and readers don't block writers (WAL).

The store keeps its in-memory dicts as a read cache; this module is the durable
backing. The public `store` API is unchanged. Postgres can later replace this
behind the same function surface.
"""
import json
import os
import sqlite3
import threading

from . import config

_conn = None
_clock = threading.RLock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS repos (
  id   TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id       TEXT PRIMARY KEY,
  job      TEXT NOT NULL,
  at       INTEGER NOT NULL,
  status   TEXT,
  duration INTEGER,
  exit     INTEGER,
  host     TEXT,
  streaming INTEGER,
  json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_job_at ON runs(job, at DESC);
CREATE TABLE IF NOT EXISTS run_logs (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  t      TEXT,
  text   TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_logs_run ON run_logs(run_id, id);
CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,   -- append-only
  at        INTEGER NOT NULL,
  principal TEXT,
  role      TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  source_ip TEXT,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
"""

RUNS_PER_JOB = 50


def conn():
    """Return the process-wide connection, opening + migrating on first use."""
    global _conn
    with _clock:
        if _conn is None:
            os.makedirs(os.path.dirname(config.DB_FILE), exist_ok=True)
            c = sqlite3.connect(config.DB_FILE, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
            c.executescript(_SCHEMA)
            c.commit()
            _conn = c
        return _conn


def reset():
    """Close the connection (tests open a fresh DB by repointing config.DB_FILE)."""
    global _conn
    with _clock:
        if _conn is not None:
            _conn.close()
            _conn = None


# ── repos ──
def set_repos(repo_dicts):
    """Replace the full repo set (repos are few and written rarely)."""
    with _clock:
        c = conn()
        c.execute("DELETE FROM repos")
        c.executemany(
            "INSERT INTO repos(id, json) VALUES(?, ?)",
            [(r["id"], json.dumps(r)) for r in repo_dicts],
        )
        c.commit()


def all_repos():
    with _clock:
        rows = conn().execute("SELECT json FROM repos").fetchall()
    return [json.loads(r["json"]) for r in rows]


def repo_count():
    with _clock:
        return conn().execute("SELECT COUNT(*) AS n FROM repos").fetchone()["n"]


# ── runs ──
def _meta_cols(run):
    return (
        run["id"], run.get("_job"), run.get("at"), run.get("status"),
        run.get("duration"), run.get("exit"), run.get("host"),
        1 if run.get("streaming") else 0,
        json.dumps({k: v for k, v in run.items() if k not in ("log", "_job")}),
    )


def insert_run(job, run):
    """Insert a new run (metadata + its seeded log lines) and prune to RUNS_PER_JOB."""
    with _clock:
        c = conn()
        r = dict(run, _job=job)
        c.execute(
            "INSERT OR REPLACE INTO runs(id, job, at, status, duration, exit, host, streaming, json)"
            " VALUES(?,?,?,?,?,?,?,?,?)", _meta_cols(r))
        for e in run.get("log", []):
            c.execute("INSERT INTO run_logs(run_id, t, text) VALUES(?,?,?)",
                      (run["id"], e.get("t"), e.get("text")))
        # prune older runs beyond the cap, and their logs
        old = c.execute(
            "SELECT id FROM runs WHERE job=? ORDER BY at DESC LIMIT -1 OFFSET ?",
            (job, RUNS_PER_JOB)).fetchall()
        for row in old:
            c.execute("DELETE FROM run_logs WHERE run_id=?", (row["id"],))
            c.execute("DELETE FROM runs WHERE id=?", (row["id"],))
        c.commit()


def append_log(run_id, entry):
    """The hot path: one row INSERT per streamed log line (no whole-file rewrite)."""
    with _clock:
        c = conn()
        c.execute("INSERT INTO run_logs(run_id, t, text) VALUES(?,?,?)",
                  (run_id, entry.get("t"), entry.get("text")))
        c.commit()


def update_run(job, run):
    """Finalize a run: update metadata and replace its log with the authoritative set."""
    with _clock:
        c = conn()
        r = dict(run, _job=job)
        c.execute(
            "INSERT OR REPLACE INTO runs(id, job, at, status, duration, exit, host, streaming, json)"
            " VALUES(?,?,?,?,?,?,?,?,?)", _meta_cols(r))
        c.execute("DELETE FROM run_logs WHERE run_id=?", (run["id"],))
        for e in run.get("log", []):
            c.execute("INSERT INTO run_logs(run_id, t, text) VALUES(?,?,?)",
                      (run["id"], e.get("t"), e.get("text")))
        c.commit()


def delete_job_runs(job):
    with _clock:
        c = conn()
        ids = [r["id"] for r in c.execute("SELECT id FROM runs WHERE job=?", (job,)).fetchall()]
        for rid in ids:
            c.execute("DELETE FROM run_logs WHERE run_id=?", (rid,))
        c.execute("DELETE FROM runs WHERE job=?", (job,))
        c.commit()


def run_count():
    with _clock:
        return conn().execute("SELECT COUNT(*) AS n FROM runs").fetchone()["n"]


def audit_insert(at, principal, role, action, target, source_ip, detail):
    with _clock:
        c = conn()
        c.execute("INSERT INTO audit(at, principal, role, action, target, source_ip, detail)"
                  " VALUES(?,?,?,?,?,?,?)", (at, principal, role, action, target, source_ip, detail))
        c.commit()


def audit_recent(limit=200):
    with _clock:
        rows = conn().execute(
            "SELECT at, principal, role, action, target, source_ip, detail"
            " FROM audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def all_runs():
    """Rebuild the in-memory {job: [run-with-log]} cache, newest first per job."""
    with _clock:
        c = conn()
        rows = c.execute("SELECT job, json FROM runs ORDER BY at DESC").fetchall()
        logs = {}
        for lr in c.execute("SELECT run_id, t, text FROM run_logs ORDER BY id ASC").fetchall():
            logs.setdefault(lr["run_id"], []).append({"t": lr["t"], "text": lr["text"]})
    out = {}
    for row in rows:
        run = json.loads(row["json"])
        run["log"] = logs.get(run["id"], [])
        out.setdefault(row["job"], []).append(run)
    return out
