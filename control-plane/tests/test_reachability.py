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
    monkeypatch.setitem(store.reachability, "attempts", 2)
    assert store._probe_one("h", 22, timeout=0.1) is True     # 1st fails, 2nd succeeds → up
    assert calls["n"] == 2


def test_hysteresis_holds_up_through_transient_failures(monkeypatch):
    store.repo_inventory.clear()
    store.host_reach.clear()
    store.repo_inventory["r"] = {"hostinfo": {"h1": {"addr": "h1", "port": 22}}}
    monkeypatch.setitem(store.reachability, "downAfter", 3)

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


def _set_rudder(yaml_text):
    store.manifests.clear()
    store.manifests["r"] = {"jobsYaml": "", "rudderYaml": yaml_text, "found": True, "playbooks": []}


def test_settings_block_overrides_defaults():
    _set_rudder(
        "settings:\n"
        "  reconcileSeconds: 300\n"
        "  runWorkers: 8\n"
        "  runQueueMax: 50\n"
        "  runTimeoutSeconds: 600\n"
        "  sshStrict: true\n"
        "  reachability:\n"
        "    intervalSeconds: 120\n"
        "    timeoutSeconds: 5\n"
        "    attempts: 3\n"
        "    downAfter: 5\n"
    )
    store._rebuild_settings()
    assert store.settings["reconcileSeconds"] == 300
    assert store.settings["runWorkers"] == 8
    assert store.settings["runQueueMax"] == 50
    assert store.settings["runTimeoutSeconds"] == 600
    assert store.settings["sshStrict"] is True
    assert store.settings["reachability"] == {"intervalSeconds": 120, "timeoutSeconds": 5.0, "attempts": 3, "downAfter": 5}


def test_settings_clamp_and_ignore_junk(monkeypatch):
    _set_rudder("settings:\n  runWorkers: 999\n  runTimeoutSeconds: bogus\n  reachability:\n    downAfter: 999\n")
    store._rebuild_settings()
    assert store.settings["runWorkers"] == 64                       # clamped to max
    assert store.settings["runTimeoutSeconds"] == config.RUN_TIMEOUT_SECONDS  # junk → default
    assert store.settings["reachability"]["downAfter"] == 20        # clamped to max


def test_no_settings_block_reverts_to_defaults():
    _set_rudder("settings:\n  runWorkers: 8\n")
    store._rebuild_settings()
    assert store.settings["runWorkers"] == 8
    _set_rudder("alerts: []\n")                                     # block removed → defaults
    store._rebuild_settings()
    assert store.settings["runWorkers"] == config.RUN_WORKERS
    assert store.settings["reachability"]["downAfter"] == config.HOST_DOWN_AFTER
