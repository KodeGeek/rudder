"""The /jobs/{name}/playbook endpoint reads the resolved playbook from the clone."""
from app import main, store


def test_reads_resolved_playbook(tmp_path):
    (tmp_path / "site.yml").write_text("- hosts: all\n  tasks: []\n")
    store.jobs.clear()
    store.jobs["j1"] = {"name": "j1", "_workdir": str(tmp_path), "playbook": "site.yml"}
    r = main.get_playbook("j1")
    assert r["found"] is True
    assert "hosts: all" in r["content"]
    assert r["path"] == "site.yml"


def test_missing_playbook_reports_not_found(tmp_path):
    store.jobs.clear()
    store.jobs["j1"] = {"name": "j1", "_workdir": str(tmp_path), "playbook": "nope.yml"}
    r = main.get_playbook("j1")
    assert r["found"] is False
    assert r["content"] == ""
