"""run_job end-to-end (subprocess stubbed): a run must create + finalize a row.

Regression for the shadowing bug where a local `log = log_lines[-400:]` made the
module-level `log` logger a function-local, so `log.info("run started", …)` raised
UnboundLocalError before the run row was ever created — the executor swallowed it
and the endpoint returned 200 while nothing happened.
"""
import pytest

from app import alerts, config, db, metrics, runner, store, telemetry, vault


class FakeProc:
    def __init__(self, lines, code=0):
        self.stdout = iter(lines)
        self.returncode = code
        self.pid = 0

    def wait(self):
        return self.returncode

    def poll(self):
        return self.returncode


@pytest.fixture
def runnable(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_FILE", str(tmp_path / "rudder.db"))
    db.reset()
    store._migrated = True
    store.jobs.clear()
    store.runs.clear()
    wd = tmp_path / "repo"
    wd.mkdir()
    store.jobs["job1"] = {
        "name": "job1", "cron": "0 0 * * *", "playbook": "p.yml", "limit": "all",
        "kind": "task", "provider": "github", "repoSlug": "a/b", "branch": "main",
        "_repoId": "github:a/b", "_workdir": str(wd), "_manifestDir": "",
    }
    # no real secrets / inventory / sinks
    monkeypatch.setattr(store, "find_inventory_file", lambda _wd: None)
    monkeypatch.setattr(vault, "repo_host_key_tempfile", lambda _r: None)
    monkeypatch.setattr(vault, "private_key_tempfile", lambda: None)
    monkeypatch.setattr(vault, "repo_vault_pass_tempfile", lambda _r: None)
    monkeypatch.setattr(telemetry, "push_metrics", lambda *a, **k: None)
    monkeypatch.setattr(telemetry, "push_logs", lambda *a, **k: None)
    monkeypatch.setattr(metrics, "record_run", lambda *a, **k: None)
    monkeypatch.setattr(alerts, "dispatch", lambda *a, **k: None)
    yield
    db.reset()


def test_run_job_creates_and_finalizes_a_successful_row(runnable, monkeypatch):
    monkeypatch.setattr(runner.subprocess, "Popen",
                        lambda *a, **k: FakeProc(["PLAY [all]\n", "ok: [h]\n", "PLAY RECAP\n"], 0))
    status = runner.run_job("job1", manual=True)        # must NOT raise UnboundLocalError
    assert status == "success"
    row = store.runs["job1"][0]
    assert row["status"] == "success" and row["exit"] == 0
    assert any("ok: [h]" in e["text"] for e in row["log"])   # streamed output finalized


def test_run_job_records_failure_exit(runnable, monkeypatch):
    monkeypatch.setattr(runner.subprocess, "Popen",
                        lambda *a, **k: FakeProc(["fatal: [h]: boom\n"], 2))
    assert runner.run_job("job1", manual=True) == "failed"
    assert store.runs["job1"][0]["exit"] == 2
