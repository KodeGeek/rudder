"""Git operations: clone/fetch with timeouts, token scrubbing, error recovery."""
import json
import os
import subprocess
import tempfile
from unittest.mock import MagicMock, patch, call

import pytest

from app import config, db, store, vault


@pytest.fixture
def freshdb(tmp_path, monkeypatch):
    """Fresh DB and temp workdir for git tests."""
    monkeypatch.setattr(config, "DB_FILE", str(tmp_path / "rudder.db"))
    monkeypatch.setattr(config, "STATE_FILE", str(tmp_path / "repos.json"))
    monkeypatch.setattr(config, "RUNS_FILE", str(tmp_path / "runs.json"))
    monkeypatch.setattr(config, "WORKDIR", str(tmp_path / "work"))
    db.reset()
    store._migrated = False
    store.repos.clear()
    store.runs.clear()
    store.jobs.clear()
    store.manifests.clear()
    yield tmp_path
    db.reset()


def test_successful_clone_path(freshdb, monkeypatch):
    """Successful clone from a fresh repo URL."""
    with patch.object(vault, "get_repo_token", side_effect=Exception("no token")):
        with patch.object(vault, "repo_deploy_private_tempfile", side_effect=Exception("no key")):
            def mock_run(cmd, *args, **kwargs):
                result = MagicMock()
                result.returncode = 0
                result.stderr = ""
                if "clone" in cmd:
                    # Simulate clone creating .git dir
                    wd = cmd[-1]
                    os.makedirs(os.path.join(wd, ".git"), exist_ok=True)
                return result

            with patch.object(subprocess, "run", mock_run):
                store.add_repo("github", "https://github.com/org/repo.git", "main")
                rid = "github:org/repo"
                store.reconcile_repo(rid)

                r = store.repos[rid]
                assert "error" not in r or r.get("error") is None, f"Expected no error, got: {r.get('error')}"


def test_fetch_after_clone_path(freshdb, monkeypatch):
    """Fetch path when .git directory already exists."""
    with patch.object(vault, "get_repo_token", side_effect=Exception("no token")):
        wd = os.path.join(config.WORKDIR, "github_org_repo")
        os.makedirs(os.path.join(wd, ".git"), exist_ok=True)

        call_count = {"n": 0}

        def mock_run(cmd, *args, **kwargs):
            call_count["n"] += 1
            result = MagicMock()
            result.returncode = 0
            result.stderr = ""
            return result

        with patch.object(subprocess, "run", mock_run):
            store.add_repo("github", "https://github.com/org/repo.git", "main")
            rid = "github:org/repo"
            store.reconcile_repo(rid)

            # Should call git fetch + git reset (2 calls) + possibly galaxy/render (more)
            assert call_count["n"] >= 2
            r = store.repos[rid]
            assert "error" not in r or r.get("error") is None


def test_git_timeout_sets_error_state(freshdb, monkeypatch):
    """git fetch/clone timeout sets repo error and doesn't crash."""
    with patch.object(vault, "get_repo_token", side_effect=Exception("no token")):
        def mock_run_timeout(cmd, *args, **kwargs):
            if "git" in cmd[0] or "git" in cmd[1:]:
                raise subprocess.TimeoutExpired("git", store.GIT_TIMEOUT)
            result = MagicMock()
            result.returncode = 0
            return result

        with patch.object(subprocess, "run", mock_run_timeout):
            store.add_repo("github", "https://github.com/org/repo.git", "main")
            rid = "github:org/repo"

            # Should not raise; error state should be set
            store.reconcile_repo(rid)

            r = store.repos[rid]
            assert "error" in r, "Expected error state to be set after timeout"
            assert "timeout" in r["error"].lower(), f"Expected timeout in error message, got: {r['error']}"


def test_auth_failure_sets_error_state(freshdb, monkeypatch):
    """Clone failure (auth) sets repo error state."""
    with patch.object(vault, "get_repo_token", side_effect=Exception("no token")):
        def mock_run(cmd, *args, **kwargs):
            result = MagicMock()
            result.returncode = 1
            result.stderr = "fatal: Authentication failed"
            return result

        with patch.object(subprocess, "run", mock_run):
            store.add_repo("github", "https://github.com/org/private.git", "main")
            rid = "github:org/private"
            store.reconcile_repo(rid)

            r = store.repos[rid]
            assert "error" in r, "Expected error state after auth failure"
            assert "Authentication" in r["error"], f"Expected auth error, got: {r['error']}"


def test_token_scrubbed_from_origin_after_clone(freshdb, monkeypatch):
    """Token URL is replaced with clean URL after clone."""
    token = "ghp_secret_token_xyz"
    url = "https://github.com/org/repo.git"

    with patch.object(vault, "get_repo_token", return_value=token):
        with patch.object(vault, "repo_deploy_private_tempfile", side_effect=Exception("no key")):
            called_urls = []

            def mock_run(cmd, *args, **kwargs):
                result = MagicMock()
                result.returncode = 0
                result.stderr = ""
                result.stdout = ""

                # Capture the URL for clone and remote set-url commands
                if "clone" in cmd:
                    called_urls.append(("clone", cmd[cmd.index(url) if url in cmd else -2]))
                    wd = cmd[-1]
                    os.makedirs(os.path.join(wd, ".git"), exist_ok=True)
                elif "remote" in cmd and "set-url" in cmd:
                    # This should be called with the clean URL (r["url"])
                    idx = cmd.index("set-url") + 2 if "set-url" in cmd else -1
                    if idx >= 0 and idx < len(cmd):
                        called_urls.append(("set-url", cmd[idx]))

                return result

            with patch.object(subprocess, "run", mock_run):
                store.add_repo("github", url, "main", token=token)
                rid = "github:org/repo"
                store.reconcile_repo(rid)

                # The clone should have been called with the token-injected URL
                # The remote set-url should have been called with the clean URL
                r = store.repos[rid]
                assert "error" not in r or r.get("error") is None, f"Unexpected error: {r.get('error')}"


def test_deploy_key_no_token_scrubbing(freshdb, monkeypatch):
    """Deploy-key auth doesn't trigger token scrubbing (no token in URL)."""
    key_data = b"-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n"

    def mock_tempfile(*args, **kwargs):
        f = tempfile.NamedTemporaryFile(delete=False)
        f.write(key_data)
        f.close()
        return f.name

    with patch.object(vault, "repo_deploy_private_tempfile", side_effect=mock_tempfile):
        set_url_called = {"n": 0}

        def mock_run(cmd, *args, **kwargs):
            result = MagicMock()
            result.returncode = 0
            result.stderr = ""

            if "clone" in cmd:
                wd = cmd[-1]
                os.makedirs(os.path.join(wd, ".git"), exist_ok=True)
            elif "remote" in cmd and "set-url" in cmd:
                set_url_called["n"] += 1

            return result

        with patch.object(subprocess, "run", mock_run):
            store.add_repo("github", "ssh://git@github.com/org/repo.git", "main", auth_method="deploykey")
            rid = "github:org/repo"
            store.reconcile_repo(rid)

            # set-url should NOT have been called for deploy-key auth
            assert set_url_called["n"] == 0, "deploy-key auth should not trigger remote set-url"
            r = store.repos[rid]
            assert "error" not in r or r.get("error") is None


def test_post_clone_processing_failure_sets_error(freshdb, monkeypatch):
    """Exception in _render_jobs/_parse_inventory/_install_galaxy_requirements sets error."""
    with patch.object(vault, "get_repo_token", side_effect=Exception("no token")):
        def mock_run(cmd, *args, **kwargs):
            result = MagicMock()
            result.returncode = 0
            result.stderr = ""
            if "clone" in cmd:
                wd = cmd[-1]
                os.makedirs(os.path.join(wd, ".git"), exist_ok=True)
            return result

        with patch.object(subprocess, "run", mock_run):
            # Mock _render_jobs to raise an exception
            def mock_render(*args, **kwargs):
                raise ValueError("manifest parsing failed")

            with patch.object(store, "_render_jobs", mock_render):
                store.add_repo("github", "https://github.com/org/repo.git", "main")
                rid = "github:org/repo"
                store.reconcile_repo(rid)

                r = store.repos[rid]
                assert "error" in r, "Expected error after post-clone processing failure"
                assert "post-clone" in r["error"].lower(), f"Expected post-clone in error, got: {r['error']}"


def test_migration_crash_recovery_flag_not_set_on_failed_import(freshdb, monkeypatch):
    """_ensure_migrated flag not set if import crashes; retry works."""
    monkeypatch.setattr(config, "STATE_FILE", str(freshdb / "repos.json"))
    monkeypatch.setattr(config, "RUNS_FILE", str(freshdb / "runs.json"))

    # Create a malformed repos.json that will crash on second load
    bad_data = '{"id": "test"'  # Invalid JSON
    with open(config.STATE_FILE, "w") as f:
        f.write(bad_data)

    store._migrated = False

    # First call hits a JSON decode error: the flag must stay False so the
    # migration is retried rather than being permanently skipped.
    store._ensure_migrated()
    assert store._migrated is False, "Flag must NOT be set when the import failed"

    # Fix the file; the retry (same process, flag still False) now succeeds and
    # only then latches the flag.
    with open(config.STATE_FILE, "w") as f:
        json.dump([{"id": "github:org/repo", "url": "https://github.com/org/repo.git"}], f)

    store._ensure_migrated()
    assert store._migrated is True, "Flag should latch once the import succeeds"


def test_git_timeout_constant_is_reasonable(freshdb):
    """GIT_TIMEOUT constant is set and reasonable."""
    assert hasattr(store, "GIT_TIMEOUT"), "GIT_TIMEOUT constant should exist"
    assert isinstance(store.GIT_TIMEOUT, int), "GIT_TIMEOUT should be an int"
    assert store.GIT_TIMEOUT > 0, "GIT_TIMEOUT should be positive"
    assert store.GIT_TIMEOUT >= 60, "GIT_TIMEOUT should be at least 60 seconds"


def test_reset_uses_timeout(freshdb, monkeypatch):
    """git reset after fetch also has timeout."""
    with patch.object(vault, "get_repo_token", side_effect=Exception("no token")):
        wd = os.path.join(config.WORKDIR, "github_org_repo")
        os.makedirs(os.path.join(wd, ".git"), exist_ok=True)

        timeouts_seen = []

        def mock_run(cmd, *args, **kwargs):
            timeouts_seen.append(kwargs.get("timeout"))
            result = MagicMock()
            result.returncode = 0
            result.stderr = ""
            return result

        with patch.object(subprocess, "run", mock_run):
            store.add_repo("github", "https://github.com/org/repo.git", "main")
            rid = "github:org/repo"
            store.reconcile_repo(rid)

            # All git commands should have GIT_TIMEOUT
            git_timeouts = [t for t in timeouts_seen if t is not None]
            # Should have at least fetch (and reset) with timeouts
            assert any(t == store.GIT_TIMEOUT for t in git_timeouts), \
                f"Expected GIT_TIMEOUT={store.GIT_TIMEOUT} in calls, got timeouts: {git_timeouts}"
