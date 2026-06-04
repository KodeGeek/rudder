"""SSH run-key rotation generates a fresh key, stores it, never returns the private."""
import shutil

import pytest

from app import vault


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="ssh-keygen not available")
def test_rotate_generates_and_stores(monkeypatch):
    stored = {}
    monkeypatch.setattr(vault, "_kv_write", lambda path, data: stored.update(path=path, data=data))
    res = vault.rotate_ssh_key()
    assert res["public"].startswith("ssh-ed25519")
    assert "private" not in res                       # private never returned
    assert res["rotated"] > 0
    assert stored["data"]["private"].startswith("-----BEGIN")   # private went to Vault
    assert stored["data"]["rotated"] == res["rotated"]
