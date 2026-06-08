"""Bounded run queue: single-flight per job (409) and backpressure (429)."""
import threading

import pytest

from app import config, runner, store


@pytest.fixture
def gated(monkeypatch):
    """Replace run_job with a fake that blocks until released, so we can fill the
    queue deterministically. _pool.submit looks up the module-global run_job at
    call time, so monkeypatching it here takes effect."""
    release = threading.Event()
    started = threading.Semaphore(0)

    def fake_run_job(name, manual=False):
        started.release()
        release.wait(timeout=5)
        return "success"

    monkeypatch.setattr(runner, "run_job", fake_run_job)
    runner._inflight.clear()
    yield release, started
    release.set()
    runner._inflight.clear()


def test_single_flight_rejects_duplicate(gated, monkeypatch):
    release, started = gated
    monkeypatch.setitem(store.settings, "runQueueMax", 100)
    runner.run_async("jobA")
    started.acquire(timeout=5)                       # ensure it's running
    with pytest.raises(runner.AlreadyRunning):
        runner.run_async("jobA")


def test_backpressure_when_saturated(gated, monkeypatch):
    release, started = gated
    monkeypatch.setitem(store.settings, "runQueueMax", 2)
    runner.run_async("job0")
    runner.run_async("job1")
    with pytest.raises(runner.QueueFull):
        runner.run_async("job2")


def test_slot_frees_after_completion(gated, monkeypatch):
    release, started = gated
    monkeypatch.setitem(store.settings, "runQueueMax", 1)
    fut = runner.run_async("job0")
    with pytest.raises(runner.QueueFull):
        runner.run_async("job1")                     # full
    release.set()
    fut.result(timeout=5)                            # let job0 finish
    runner.run_async("job1")                         # slot freed → accepted
