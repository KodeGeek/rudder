"""Security: playbook path traversal, INI injection in limits, process kill hardening."""
import os
import re
import tempfile

import pytest

from app import config, runner, store


def _resolves_inside(path, wd):
    """The resolved path must stay inside wd — boundary-safe (no prefix bypass)."""
    rp, real_wd = os.path.realpath(path), os.path.realpath(wd)
    return rp == real_wd or rp.startswith(real_wd + os.sep)


class TestPlaybookTraversal:
    """Path traversal in _resolve_playbook must be rejected."""

    def test_traversal_escape_rejected(self, tmp_path):
        """../secret.yml pointing at a real file outside the repo must never be
        handed back as an openable path."""
        wd = tmp_path / "repo"
        wd.mkdir()
        secret = tmp_path / "secret.yml"           # sits in wd's parent
        secret.write_text("- hosts: all")

        j = {"_workdir": str(wd), "playbook": "../secret.yml", "_manifestDir": ""}
        path = runner._resolve_playbook(j)
        assert os.path.realpath(path) != os.path.realpath(str(secret)), \
            "traversal resolved to the outside secret"
        assert _resolves_inside(path, wd), f"escaped repo root: {path}"

    def test_sibling_prefix_escape_rejected(self, tmp_path):
        """../repo-evil/x.yml must be rejected — the boundary check must not be
        fooled by a sibling dir that shares the repo's name prefix."""
        wd = tmp_path / "repo"
        wd.mkdir()
        evil = tmp_path / "repo-evil"               # startswith('/.../repo') but NOT inside it
        evil.mkdir()
        (evil / "x.yml").write_text("- hosts: all")

        j = {"_workdir": str(wd), "playbook": "../repo-evil/x.yml", "_manifestDir": ""}
        path = runner._resolve_playbook(j)
        assert os.path.realpath(path) != os.path.realpath(str(evil / "x.yml")), \
            "sibling-prefix traversal resolved to the outside file"
        assert _resolves_inside(path, wd), f"escaped repo root: {path}"

    def test_nested_safe_path_resolves(self, tmp_path):
        """playbooks/deploy.yml within repo must resolve normally."""
        wd = tmp_path / "repo"
        wd.mkdir()
        (wd / "playbooks").mkdir()
        (wd / "playbooks" / "deploy.yml").write_text("---")

        j = {
            "_workdir": str(wd),
            "playbook": "playbooks/deploy.yml",
            "_manifestDir": "",
        }
        path = runner._resolve_playbook(j)
        assert os.path.exists(path)
        assert "deploy.yml" in path


class TestInventoryLimitSanitization:
    """Limit field must be sanitized before INI interpolation."""

    def test_limit_with_newline_injection_sanitized(self, monkeypatch):
        """limit='web]\nevil=1' must not inject lines into INI."""
        monkeypatch.setitem(store.settings, "sshStrict", False)
        inv_file, grp = runner._inventory("web]\nevil=1")
        try:
            content = open(inv_file).read()
            # The group name must be sanitized: no ] or newline allowed in the actual INI
            assert "web]\nevil=1" not in content or \
                   (re.search(r'\[web[^\]]*\]', content) and "evil=1" not in content), \
                   f"Injected content found in INI:\n{content}"
            # Group name should be sanitized to [web_evil_1] or similar
            assert re.search(r'\[web_[^\]]*\]', content), f"Sanitized group not found in:\n{content}"
        finally:
            if os.path.exists(inv_file):
                os.unlink(inv_file)

    def test_normal_limit_unchanged(self, monkeypatch):
        """limit='webservers' must remain unchanged in INI."""
        monkeypatch.setitem(store.settings, "sshStrict", False)
        inv_file, grp = runner._inventory("webservers")
        try:
            content = open(inv_file).read()
            assert "[webservers]" in content
            assert grp == "webservers"
        finally:
            if os.path.exists(inv_file):
                os.unlink(inv_file)

    def test_empty_limit_uses_all_hosts(self, monkeypatch):
        """Empty limit must use 'all_hosts' as group."""
        monkeypatch.setitem(store.settings, "sshStrict", False)
        inv_file, grp = runner._inventory("")
        try:
            content = open(inv_file).read()
            assert "[all_hosts]" in content
            assert grp == "all_hosts"
        finally:
            if os.path.exists(inv_file):
                os.unlink(inv_file)
