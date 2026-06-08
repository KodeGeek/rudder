"""Host reachability: retry within a probe + hysteresis so blips don't flap."""
from app import config, store


def test_probe_retries_before_declaring_down(monkeypatch):
    calls = {"n": 0}

    class FakeConn:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_create(addr, timeout):
        calls["n"] += 1
        if calls["n"] < 2:
            raise OSError("transient jitter")
        return FakeConn()

    monkeypatch.setattr(store.socket, "create_connection", fake_create)
    monkeypatch.setattr(store.time, "sleep", lambda *_: None)
    monkeypatch.setattr(config, "HOST_PROBE_ATTEMPTS", 2)
    assert store._probe_one("h", 22, timeout=0.1) is True     # 1st fails, 2nd succeeds → up
    assert calls["n"] == 2


def test_hysteresis_holds_up_through_transient_failures(monkeypatch):
    store.repo_inventory.clear()
    store.host_reach.clear()
    store.repo_inventory["r"] = {"hostinfo": {"h1": {"addr": "h1", "port": 22}}}
    monkeypatch.setattr(config, "HOST_DOWN_AFTER", 3)

    monkeypatch.setattr(store, "_probe_one", lambda *a, **k: True)
    store.probe_inventory()
    assert store.host_reach["h1"]["up"] is True

    # consecutive failures: stay up for 1 and 2, flip down only on the 3rd
    monkeypatch.setattr(store, "_probe_one", lambda *a, **k: False)
    store.probe_inventory(); assert store.host_reach["h1"]["up"] is True
    store.probe_inventory(); assert store.host_reach["h1"]["up"] is True
    store.probe_inventory(); assert store.host_reach["h1"]["up"] is False

    # recovers immediately on the next success, counter reset
    monkeypatch.setattr(store, "_probe_one", lambda *a, **k: True)
    store.probe_inventory()
    assert store.host_reach["h1"]["up"] is True and store.host_reach["h1"]["fails"] == 0
