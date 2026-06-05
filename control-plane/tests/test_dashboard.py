"""dashboard: block in rudder.yml → normalized layout, degrading safely on junk."""
from app import store


def _set(rudder_yaml):
    store.manifests.clear()
    store.manifests["github:a/b"] = {"jobsYaml": "", "rudderYaml": rudder_yaml,
                                     "found": True, "playbooks": []}


def test_none_when_no_dashboard_block():
    _set("alerts:\n  - type: slack\n    target: '#ops'\n")
    assert store.dashboard_view() is None


def test_valid_block_round_trips_and_clamps():
    _set(
        "dashboard:\n"
        "  cols: 12\n"
        "  widgets:\n"
        "    - { type: verdict, x: 0, y: 0, w: 12, h: 2 }\n"
        "    - { type: metric, metric: success-rate, x: 0, y: 2, w: 4, h: 2 }\n"
    )
    layout = store.dashboard_view()
    assert layout["cols"] == 12 and len(layout["widgets"]) == 2
    assert layout["widgets"][0] == {"type": "verdict", "x": 0, "y": 0, "w": 12, "h": 2}
    assert layout["widgets"][1]["metric"] == "success-rate"


def test_malformed_yaml_is_none_not_raise():
    _set("dashboard:\n  widgets: [ this is : : broken\n")
    assert store.dashboard_view() is None          # must not raise


def test_junk_widgets_dropped_and_bounds_clamped():
    _set(
        "dashboard:\n"
        "  cols: 8\n"
        "  widgets:\n"
        "    - 'not a dict'\n"                       # dropped
        "    - { x: 1, y: 1 }\n"                     # no type → dropped
        "    - { type: server-resources, x: 99, y: 0, w: 99, h: 'x' }\n"  # clamped + coerced
    )
    layout = store.dashboard_view()
    assert layout["cols"] == 8 and len(layout["widgets"]) == 1
    w = layout["widgets"][0]
    assert w["type"] == "server-resources"
    assert w["w"] == 8 and w["x"] == 0 and w["h"] == 2   # w clamped to cols, x→cols-w, bad h→default


def test_empty_widgets_is_none():
    _set("dashboard:\n  widgets: []\n")
    assert store.dashboard_view() is None
