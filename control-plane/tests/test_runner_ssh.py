"""SSH host-key trust: TOFU by default, strict when configured (no blanket trust)."""
from app import config, runner


def test_default_is_trust_on_first_use(tmp_path, monkeypatch):
    kh = str(tmp_path / "known_hosts")
    monkeypatch.setattr(config, "SSH_KNOWN_HOSTS", kh)
    monkeypatch.setattr(config, "SSH_STRICT", False)
    args = runner._ssh_args()
    assert "StrictHostKeyChecking=accept-new" in args
    assert f"UserKnownHostsFile={kh}" in args
    assert "StrictHostKeyChecking=no" not in args        # the old unsafe blanket-trust is gone
    assert "/dev/null" not in args


def test_strict_mode(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SSH_KNOWN_HOSTS", str(tmp_path / "known_hosts"))
    monkeypatch.setattr(config, "SSH_STRICT", True)
    assert "StrictHostKeyChecking=yes" in runner._ssh_args()
