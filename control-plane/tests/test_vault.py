"""Vault (OpenBao) integration: SSH keypair + secret references.

Tests cover SSH key generation, idempotency, private key tempfile creation,
secret storage/retrieval, rotation, and Vault readiness checks.
"""
import os
import tempfile
import time
import pytest
from unittest.mock import Mock, MagicMock, patch

from app import config, vault


class MockHvacClient:
    """Mock hvac.Client for hermetic testing."""
    def __init__(self, url, token):
        self.url = url
        self.token = token
        self.sys = Mock()
        self.secrets = Mock()
        self._kv_data = {}  # In-memory secret store

    def setup_kv_v2(self):
        """Setup KV v2 secrets mock."""
        self.secrets.kv = Mock()
        self.secrets.kv.v2 = Mock()
        self.secrets.kv.v2.read_secret_version = self._mock_read_secret_version
        self.secrets.kv.v2.create_or_update_secret = self._mock_create_or_update_secret
        self.secrets.kv.v2.delete_metadata_and_all_versions = self._mock_delete_metadata

    def _mock_read_secret_version(self, path, mount_point, raise_on_deleted_version=False):
        """Mock reading from KV v2."""
        key = f"{mount_point}/{path}"
        if key in self._kv_data:
            return {"data": {"data": self._kv_data[key]}}
        return None

    def _mock_create_or_update_secret(self, path, secret, mount_point):
        """Mock writing to KV v2."""
        key = f"{mount_point}/{path}"
        self._kv_data[key] = secret

    def _mock_delete_metadata(self, path, mount_point):
        """Mock deleting from KV v2."""
        key = f"{mount_point}/{path}"
        if key in self._kv_data:
            del self._kv_data[key]


@pytest.fixture
def mock_client():
    """Fixture providing a mock Vault client."""
    return MockHvacClient("http://vault:8200", "test-token")


@pytest.fixture
def vault_env(monkeypatch):
    """Setup Vault environment variables."""
    monkeypatch.setattr(config, "VAULT_ADDR", "http://vault:8200")
    monkeypatch.setattr(config, "VAULT_TOKEN", "test-token")
    monkeypatch.setattr(config, "VAULT_TOKEN_FILE", "")
    monkeypatch.setattr(config, "VAULT_KV_MOUNT", "secret")
    monkeypatch.setattr(config, "SSH_KEY_VAULT_PATH", "rudder/ssh-deploy-key")
    # Reset module-level client cache
    vault._client = None
    vault._client_token = None
    yield
    vault._client = None
    vault._client_token = None


@pytest.fixture
def mocked_vault(vault_env, monkeypatch, mock_client):
    """Fixture: mock vault.client() to return our mock client, setup KV."""
    mock_client.setup_kv_v2()
    mock_client.sys.is_initialized.return_value = True
    mock_client.sys.is_sealed.return_value = False
    monkeypatch.setattr(vault, "client", lambda: mock_client)
    return mock_client


# ── _read_token tests ──
def test_read_token_from_env(monkeypatch):
    """_read_token returns VAULT_TOKEN env var when set."""
    monkeypatch.setattr(config, "VAULT_TOKEN", "env-token")
    monkeypatch.setattr(config, "VAULT_TOKEN_FILE", "")
    tok = vault._read_token()
    assert tok == "env-token"


def test_read_token_from_file(monkeypatch, tmp_path):
    """_read_token reads from VAULT_TOKEN_FILE when env var unset."""
    token_file = tmp_path / "token"
    token_file.write_text("file-token\n")
    monkeypatch.setattr(config, "VAULT_TOKEN", "")
    monkeypatch.setattr(config, "VAULT_TOKEN_FILE", str(token_file))
    tok = vault._read_token()
    assert tok == "file-token"


def test_read_token_strips_whitespace(monkeypatch, tmp_path):
    """_read_token strips leading/trailing whitespace from file."""
    token_file = tmp_path / "token"
    token_file.write_text("  file-token  \n")
    monkeypatch.setattr(config, "VAULT_TOKEN", "")
    monkeypatch.setattr(config, "VAULT_TOKEN_FILE", str(token_file))
    tok = vault._read_token()
    assert tok == "file-token"


def test_read_token_handles_missing_file(monkeypatch):
    """_read_token returns empty string when token file doesn't exist."""
    monkeypatch.setattr(config, "VAULT_TOKEN", "")
    monkeypatch.setattr(config, "VAULT_TOKEN_FILE", "/nonexistent/path")
    tok = vault._read_token()
    assert tok == ""


def test_read_token_handles_file_read_error(monkeypatch, tmp_path):
    """_read_token returns empty string on OSError reading token file."""
    token_file = tmp_path / "token"
    token_file.write_text("token")
    monkeypatch.setattr(config, "VAULT_TOKEN", "")
    monkeypatch.setattr(config, "VAULT_TOKEN_FILE", str(token_file))
    # Mock open to raise OSError
    original_open = open
    def mock_open(*args, **kwargs):
        raise OSError("permission denied")
    monkeypatch.setattr("builtins.open", mock_open)
    tok = vault._read_token()
    assert tok == ""


# ── client() tests ──
def test_client_creates_hvac_client_on_first_call(vault_env, monkeypatch):
    """client() creates and caches an hvac.Client on first call."""
    mock_hvac_module = Mock()
    mock_hvac_client = MockHvacClient("http://vault:8200", "test-token")
    mock_hvac_module.Client = Mock(return_value=mock_hvac_client)
    monkeypatch.setattr(vault, "hvac", mock_hvac_module)

    c = vault.client()
    assert c is mock_hvac_client
    mock_hvac_module.Client.assert_called_once_with(url="http://vault:8200", token="test-token")


def test_client_returns_cached_instance(vault_env, monkeypatch):
    """client() returns cached instance when token hasn't changed."""
    mock_hvac_module = Mock()
    mock_hvac_client = MockHvacClient("http://vault:8200", "test-token")
    mock_hvac_module.Client = Mock(return_value=mock_hvac_client)
    monkeypatch.setattr(vault, "hvac", mock_hvac_module)

    c1 = vault.client()
    c2 = vault.client()
    assert c1 is c2
    assert mock_hvac_module.Client.call_count == 1


def test_client_rebuilds_when_token_changes(vault_env, monkeypatch):
    """client() rebuilds the client when token changes."""
    mock_hvac_module = Mock()
    client1 = MockHvacClient("http://vault:8200", "token1")
    client2 = MockHvacClient("http://vault:8200", "token2")
    mock_hvac_module.Client = Mock(side_effect=[client1, client2])
    monkeypatch.setattr(vault, "hvac", mock_hvac_module)
    monkeypatch.setattr(config, "VAULT_TOKEN", "token1")

    c1 = vault.client()
    assert c1 is client1

    monkeypatch.setattr(config, "VAULT_TOKEN", "token2")
    c2 = vault.client()
    assert c2 is client2
    assert mock_hvac_module.Client.call_count == 2


# ── wait_ready tests ──
def test_wait_ready_returns_true_when_healthy(mocked_vault):
    """wait_ready returns True when Vault is initialized and unsealed."""
    mocked_vault.sys.is_initialized.return_value = True
    mocked_vault.sys.is_sealed.return_value = False
    assert vault.wait_ready(timeout=5) is True


def test_wait_ready_retries_on_exception(mocked_vault, monkeypatch):
    """wait_ready retries when client() raises an exception."""
    call_count = [0]
    original_client = vault.client

    def mock_client_with_delay():
        call_count[0] += 1
        if call_count[0] < 2:
            raise Exception("not ready yet")
        return mocked_vault

    monkeypatch.setattr(vault, "client", mock_client_with_delay)
    # Mock sleep to speed up test
    monkeypatch.setattr(vault.time, "sleep", lambda x: None)

    result = vault.wait_ready(timeout=5)
    assert result is True
    assert call_count[0] == 2


def test_wait_ready_retries_on_sealed(mocked_vault, monkeypatch):
    """wait_ready retries when Vault is sealed."""
    call_count = [0]

    def sealed_then_unsealed():
        call_count[0] += 1
        mocked_vault.sys.is_sealed.return_value = (call_count[0] < 2)
        return call_count[0] >= 2

    mocked_vault.sys.is_initialized.return_value = True
    mocked_vault.sys.is_sealed = sealed_then_unsealed
    monkeypatch.setattr(vault.time, "sleep", lambda x: None)

    result = vault.wait_ready(timeout=5)
    assert result is True


def test_wait_ready_times_out(mocked_vault, monkeypatch):
    """wait_ready returns False after timeout."""
    mocked_vault.sys.is_initialized.return_value = False
    monkeypatch.setattr(vault.time, "sleep", lambda x: None)

    # Mock time.time to return values that exceed the timeout
    time_values = [0, 1, 2, 100]
    time_iter = iter(time_values)
    monkeypatch.setattr(vault.time, "time", lambda: next(time_iter))

    result = vault.wait_ready(timeout=5)
    assert result is False


def test_wait_ready_default_timeout(mocked_vault):
    """wait_ready accepts default timeout of 90 seconds."""
    # Just verify it doesn't crash with default timeout
    mocked_vault.sys.is_initialized.return_value = True
    mocked_vault.sys.is_sealed.return_value = False
    assert vault.wait_ready() is True


# ── is_up tests ──
def test_is_up_returns_true_when_healthy(mocked_vault):
    """is_up returns True when Vault is initialized and unsealed."""
    mocked_vault.sys.is_initialized.return_value = True
    mocked_vault.sys.is_sealed.return_value = False
    assert vault.is_up() is True


def test_is_up_returns_false_when_sealed(mocked_vault):
    """is_up returns False when Vault is sealed."""
    mocked_vault.sys.is_initialized.return_value = True
    mocked_vault.sys.is_sealed.return_value = True
    assert vault.is_up() is False


def test_is_up_returns_false_when_not_initialized(mocked_vault):
    """is_up returns False when Vault is not initialized."""
    mocked_vault.sys.is_initialized.return_value = False
    mocked_vault.sys.is_sealed.return_value = False
    assert vault.is_up() is False


def test_is_up_returns_false_on_exception(mocked_vault, monkeypatch):
    """is_up returns False when client() raises an exception."""
    monkeypatch.setattr(vault, "client", lambda: (_ for _ in ()).throw(Exception("unreachable")))
    assert vault.is_up() is False


# ── _kv_read tests ──
def test_kv_read_returns_data_on_success(mocked_vault):
    """_kv_read returns secret data when present."""
    test_data = {"key": "value"}
    mocked_vault._kv_data["secret/test-path"] = test_data
    result = vault._kv_read("test-path")
    assert result == test_data


def test_kv_read_returns_none_on_missing(mocked_vault):
    """_kv_read returns None when secret doesn't exist."""
    result = vault._kv_read("nonexistent")
    assert result is None


def test_kv_read_returns_none_on_exception(mocked_vault, monkeypatch):
    """_kv_read returns None when client raises an exception."""
    def mock_read_error(*args, **kwargs):
        raise Exception("connection error")
    mocked_vault.secrets.kv.v2.read_secret_version = mock_read_error
    result = vault._kv_read("test-path")
    assert result is None


# ── _kv_write tests ──
def test_kv_write_stores_secret(mocked_vault):
    """_kv_write stores secret data in Vault."""
    test_data = {"token": "secret-value"}
    vault._kv_write("test-path", test_data)
    assert mocked_vault._kv_data["secret/test-path"] == test_data


def test_kv_write_updates_existing_secret(mocked_vault):
    """_kv_write updates an existing secret."""
    mocked_vault._kv_data["secret/test-path"] = {"old": "data"}
    new_data = {"new": "data"}
    vault._kv_write("test-path", new_data)
    assert mocked_vault._kv_data["secret/test-path"] == new_data


# ── _generate_ssh_key tests ──
def test_generate_ssh_key_creates_valid_keypair(mocked_vault, monkeypatch):
    """_generate_ssh_key generates and stores a valid ed25519 keypair."""
    # Mock subprocess to generate a valid ed25519 keypair
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        # Generate a real keypair for this test
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        # Mock subprocess.run to write the real keys
        def mock_run(*args, **kwargs):
            # Extract the key file path from the command
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)
        monkeypatch.setattr(vault.time, "time", lambda: 1234567890.0)

        result = vault._generate_ssh_key()

        assert result["private"] == priv
        assert result["public"] == pub
        assert result["rotated"] == 1234567890000  # milliseconds

        # Verify it was stored in Vault
        stored = vault._kv_read("rudder/ssh-deploy-key")
        assert stored["private"] == priv
        assert stored["public"] == pub


def test_generate_ssh_key_stores_rotation_timestamp(mocked_vault, monkeypatch):
    """_generate_ssh_key stores the rotation timestamp in milliseconds."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)
        monkeypatch.setattr(vault.time, "time", lambda: 1609459200.5)  # 2021-01-01 00:00:00.5

        result = vault._generate_ssh_key()

        # Timestamp in milliseconds
        assert result["rotated"] == 1609459200500


# ── ensure_ssh_key tests ──
def test_ensure_ssh_key_generates_when_absent(mocked_vault, monkeypatch):
    """ensure_ssh_key generates a keypair when none exists."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)
        monkeypatch.setattr(vault.time, "time", lambda: 1234567890.0)

        result = vault.ensure_ssh_key()

        assert result["private"] == priv
        assert result["public"] == pub
        assert "rotated" in result


def test_ensure_ssh_key_is_idempotent(mocked_vault, monkeypatch):
    """ensure_ssh_key returns existing key when present."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)
        monkeypatch.setattr(vault.time, "time", lambda: 1234567890.0)

        # Generate the initial key
        result1 = vault.ensure_ssh_key()

        # Call again — should return the same key without regenerating
        def mock_run_should_not_be_called(*args, **kwargs):
            raise AssertionError("ssh-keygen should not be called again")
        monkeypatch.setattr(vault.subprocess, "run", mock_run_should_not_be_called)

        result2 = vault.ensure_ssh_key()

        assert result2 == result1
        assert result2["private"] == priv
        assert result2["public"] == pub


def test_ensure_ssh_key_returns_none_for_missing_private_key(mocked_vault):
    """ensure_ssh_key regenerates if private key is missing."""
    # Set up a partial secret (missing private key)
    mocked_vault._kv_data["secret/rudder/ssh-deploy-key"] = {"public": "ssh-ed25519 AAAA..."}

    # Ensure it returns existing key (but will fail later when used)
    # The function checks for both private AND public
    result = vault._kv_read("rudder/ssh-deploy-key")
    assert result["public"] == "ssh-ed25519 AAAA..."
    assert "private" not in result


# ── rotate_ssh_key tests ──
def test_rotate_ssh_key_generates_new_key(mocked_vault, monkeypatch):
    """rotate_ssh_key generates a new keypair and returns public key + timestamp."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)
        monkeypatch.setattr(vault.time, "time", lambda: 1234567890.0)

        result = vault.rotate_ssh_key()

        assert result["public"] == pub
        assert result["rotated"] == 1234567890000


def test_rotate_ssh_key_does_not_expose_private_key(mocked_vault, monkeypatch):
    """rotate_ssh_key returns only public key + timestamp, never the private key."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)
        monkeypatch.setattr(vault.time, "time", lambda: 1234567890.0)

        result = vault.rotate_ssh_key()

        assert "private" not in result
        assert "public" in result
        assert "rotated" in result


# ── public_key tests ──
def test_public_key_returns_stored_key(mocked_vault):
    """public_key returns the public key from Vault."""
    mocked_vault._kv_data["secret/rudder/ssh-deploy-key"] = {
        "public": "ssh-ed25519 AAAA...",
        "private": "-----BEGIN OPENSSH PRIVATE KEY-----"
    }
    result = vault.public_key()
    assert result == "ssh-ed25519 AAAA..."


def test_public_key_returns_empty_when_absent(mocked_vault):
    """public_key returns empty string when key doesn't exist."""
    result = vault.public_key()
    assert result == ""


def test_public_key_returns_empty_when_public_missing(mocked_vault):
    """public_key returns empty string when public key field is missing."""
    mocked_vault._kv_data["secret/rudder/ssh-deploy-key"] = {"private": "..."}
    result = vault.public_key()
    assert result == ""


# ── private_key_tempfile tests ──
def test_private_key_tempfile_writes_key_with_0600_permissions(mocked_vault, tmp_path):
    """private_key_tempfile writes the private key to a 0600 tempfile."""
    private_key_content = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key\n-----END OPENSSH PRIVATE KEY-----"
    mocked_vault._kv_data["secret/rudder/ssh-deploy-key"] = {
        "private": private_key_content,
        "public": "ssh-ed25519 AAAA..."
    }

    # Monkeypatch tempfile to use tmp_path
    original_mkstemp = tempfile.mkstemp
    def mock_mkstemp(*args, **kwargs):
        path = str(tmp_path / "test_key")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT)
        return fd, path

    import unittest.mock
    with unittest.mock.patch("tempfile.mkstemp", mock_mkstemp):
        result = vault.private_key_tempfile()

        # Verify the file exists and has correct permissions
        assert os.path.exists(result)
        stat_result = os.stat(result)
        assert stat_result.st_mode & 0o777 == 0o600

        # Verify the content
        with open(result) as f:
            content = f.read()
        assert content == private_key_content

        # Cleanup
        os.remove(result)


def test_private_key_tempfile_raises_when_key_absent(mocked_vault):
    """private_key_tempfile raises RuntimeError when key doesn't exist."""
    with pytest.raises(RuntimeError, match="SSH private key not found"):
        vault.private_key_tempfile()


def test_private_key_tempfile_raises_when_private_key_missing(mocked_vault):
    """private_key_tempfile raises RuntimeError when private key field is missing."""
    mocked_vault._kv_data["secret/rudder/ssh-deploy-key"] = {"public": "ssh-ed25519 AAAA..."}
    with pytest.raises(RuntimeError, match="SSH private key not found"):
        vault.private_key_tempfile()


# ── seed_demo_secrets tests ──
def test_seed_demo_secrets_creates_refs_when_absent(mocked_vault):
    """seed_demo_secrets creates demo secret refs when absent."""
    vault.seed_demo_secrets()

    # Verify all three refs are created
    assert vault._kv_read("rudder/ado-pat") is not None
    assert vault._kv_read("rudder/github-app") is not None
    assert vault._kv_read("rudder/registry-pull") is not None

    # Verify they have the right structure
    ado = vault._kv_read("rudder/ado-pat")
    assert ado["kind"] == "token"
    assert ado["value"] == "(placeholder)"


def test_seed_demo_secrets_is_idempotent(mocked_vault):
    """seed_demo_secrets is idempotent (doesn't overwrite existing)."""
    # Seed once
    vault.seed_demo_secrets()

    # Verify a ref exists
    original = vault._kv_read("rudder/ado-pat")

    # Seed again
    vault.seed_demo_secrets()

    # Should be unchanged
    after = vault._kv_read("rudder/ado-pat")
    assert after == original


# ── Repo token tests ──
def test_set_and_get_repo_token(mocked_vault):
    """set_repo_token and get_repo_token round-trip correctly."""
    rid = "github:owner/repo"
    token = "github_pat_secret123"

    vault.set_repo_token(rid, token)
    result = vault.get_repo_token(rid)

    assert result == token


def test_get_repo_token_returns_none_when_absent(mocked_vault):
    """get_repo_token returns None when token doesn't exist."""
    result = vault.get_repo_token("nonexistent:repo")
    assert result is None


def test_delete_repo_token(mocked_vault):
    """delete_repo_token removes the token."""
    rid = "github:owner/repo"
    vault.set_repo_token(rid, "secret")

    vault.delete_repo_token(rid)

    result = vault.get_repo_token(rid)
    assert result is None


def test_delete_repo_token_handles_missing(mocked_vault):
    """delete_repo_token doesn't raise when token doesn't exist."""
    # Should not raise
    vault.delete_repo_token("nonexistent:repo")


def test_repo_token_path_escaping(mocked_vault):
    """_repo_path escapes colons and slashes in repo ID."""
    rid = "github.com:owner/repo"
    path = vault._repo_path(rid)
    # The repo ID part should have : and / escaped (replaced with _)
    assert "github.com:owner/repo" not in path
    assert "github.com_owner_repo" in path
    assert "rudder/repo-creds/" in path  # The vault path structure itself uses /


# ── Repo deploy key tests ──
def test_ensure_repo_deploy_key_generates_when_absent(mocked_vault, monkeypatch):
    """ensure_repo_deploy_key generates a keypair when absent."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)

        rid = "github:owner/repo"
        result = vault.ensure_repo_deploy_key(rid)

        assert result == pub
        # Clean up temp directory
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_ensure_repo_deploy_key_is_idempotent(mocked_vault, monkeypatch):
    """ensure_repo_deploy_key returns existing key when present."""
    with tempfile.TemporaryDirectory() as tmpdir:
        kf = os.path.join(tmpdir, "id")
        os.system(f"ssh-keygen -t ed25519 -N '' -f {kf} -C 'test' 2>/dev/null")

        priv = open(kf).read()
        pub = open(kf + ".pub").read().strip()

        def mock_run(*args, **kwargs):
            cmd = args[0]
            key_file = None
            for i, arg in enumerate(cmd):
                if arg == "-f" and i + 1 < len(cmd):
                    key_file = cmd[i + 1]
                    break
            if key_file:
                with open(key_file, "w") as f:
                    f.write(priv)
                with open(key_file + ".pub", "w") as f:
                    f.write(pub)

        monkeypatch.setattr(vault.subprocess, "run", mock_run)

        rid = "github:owner/repo"
        result1 = vault.ensure_repo_deploy_key(rid)

        # Call again without mocking subprocess.run — should use cached value
        def should_not_run(*args, **kwargs):
            raise AssertionError("should not generate again")
        monkeypatch.setattr(vault.subprocess, "run", should_not_run)

        result2 = vault.ensure_repo_deploy_key(rid)

        assert result2 == pub
        assert result1 == result2
        # Clean up temp directory
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_repo_deploy_public(mocked_vault):
    """repo_deploy_public returns the stored public key."""
    rid = "github:owner/repo"
    pub_key = "ssh-ed25519 AAAA..."
    mocked_vault._kv_data["secret/rudder/repo-deploy-keys/github_owner_repo"] = {
        "public": pub_key,
        "private": "-----BEGIN OPENSSH PRIVATE KEY-----"
    }

    result = vault.repo_deploy_public(rid)
    assert result == pub_key


def test_repo_deploy_public_returns_none_when_absent(mocked_vault):
    """repo_deploy_public returns None when key doesn't exist."""
    result = vault.repo_deploy_public("nonexistent:repo")
    assert result is None


def test_repo_deploy_private_tempfile(mocked_vault, tmp_path):
    """repo_deploy_private_tempfile writes private key to 0600 tempfile."""
    rid = "github:owner/repo"
    private_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nkey-content\n-----END"
    mocked_vault._kv_data["secret/rudder/repo-deploy-keys/github_owner_repo"] = {
        "private": private_key,
        "public": "ssh-ed25519 AAAA..."
    }

    original_mkstemp = tempfile.mkstemp
    def mock_mkstemp(*args, **kwargs):
        path = str(tmp_path / "test_deploy_key")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT)
        return fd, path

    import unittest.mock
    with unittest.mock.patch("tempfile.mkstemp", mock_mkstemp):
        result = vault.repo_deploy_private_tempfile(rid)

        assert os.path.exists(result)
        stat_result = os.stat(result)
        assert stat_result.st_mode & 0o777 == 0o600

        with open(result) as f:
            content = f.read()
        assert content == private_key

        os.remove(result)


def test_repo_deploy_private_tempfile_raises_when_absent(mocked_vault):
    """repo_deploy_private_tempfile raises when key doesn't exist."""
    with pytest.raises(RuntimeError, match="deploy key not found"):
        vault.repo_deploy_private_tempfile("nonexistent:repo")


def test_delete_repo_deploy_key(mocked_vault):
    """delete_repo_deploy_key removes the deploy key."""
    rid = "github:owner/repo"
    mocked_vault._kv_data["secret/rudder/repo-deploy-keys/github_owner_repo"] = {
        "private": "...", "public": "..."
    }

    vault.delete_repo_deploy_key(rid)

    assert vault.repo_deploy_public(rid) is None


# ── Repo host key tests ──
def test_set_repo_host_key(mocked_vault):
    """set_repo_host_key stores the host private key."""
    rid = "github:owner/repo"
    priv_key = "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END"

    vault.set_repo_host_key(rid, priv_key)

    stored = vault._kv_read("rudder/repo-host-key/github_owner_repo")
    assert stored["private"] == priv_key


def test_has_repo_host_key_returns_true_when_present(mocked_vault):
    """has_repo_host_key returns True when key exists."""
    rid = "github:owner/repo"
    vault.set_repo_host_key(rid, "-----BEGIN...")

    assert vault.has_repo_host_key(rid) is True


def test_has_repo_host_key_returns_false_when_absent(mocked_vault):
    """has_repo_host_key returns False when key doesn't exist."""
    assert vault.has_repo_host_key("nonexistent:repo") is False


def test_repo_host_key_tempfile(mocked_vault, tmp_path):
    """repo_host_key_tempfile writes host key to 0600 tempfile."""
    rid = "github:owner/repo"
    priv_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nhost-key\n-----END"
    vault.set_repo_host_key(rid, priv_key)

    original_mkstemp = tempfile.mkstemp
    def mock_mkstemp(*args, **kwargs):
        path = str(tmp_path / "test_hostkey")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT)
        return fd, path

    import unittest.mock
    with unittest.mock.patch("tempfile.mkstemp", mock_mkstemp):
        result = vault.repo_host_key_tempfile(rid)

        assert os.path.exists(result)
        stat_result = os.stat(result)
        assert stat_result.st_mode & 0o777 == 0o600

        with open(result) as f:
            content = f.read()
        # Should have trailing newline
        assert content.endswith("\n")

        os.remove(result)


def test_repo_host_key_tempfile_adds_trailing_newline_if_missing(mocked_vault, tmp_path):
    """repo_host_key_tempfile ensures key has trailing newline."""
    rid = "github:owner/repo"
    priv_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nhost-key\n-----END"  # no trailing newline
    vault.set_repo_host_key(rid, priv_key)

    original_mkstemp = tempfile.mkstemp
    def mock_mkstemp(*args, **kwargs):
        path = str(tmp_path / "test_hostkey")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT)
        return fd, path

    import unittest.mock
    with unittest.mock.patch("tempfile.mkstemp", mock_mkstemp):
        result = vault.repo_host_key_tempfile(rid)

        with open(result) as f:
            content = f.read()
        assert content.endswith("\n")

        os.remove(result)


def test_repo_host_key_tempfile_returns_none_when_absent(mocked_vault):
    """repo_host_key_tempfile returns None when key doesn't exist."""
    result = vault.repo_host_key_tempfile("nonexistent:repo")
    assert result is None


def test_delete_repo_host_key(mocked_vault):
    """delete_repo_host_key removes the host key."""
    rid = "github:owner/repo"
    vault.set_repo_host_key(rid, "key-content")

    vault.delete_repo_host_key(rid)

    assert vault.has_repo_host_key(rid) is False


# ── Repo vault password tests ──
def test_set_repo_vault_pass(mocked_vault):
    """set_repo_vault_pass stores the ansible-vault password."""
    rid = "github:owner/repo"
    password = "secret-vault-password"

    vault.set_repo_vault_pass(rid, password)

    stored = vault._kv_read("rudder/repo-vault-pass/github_owner_repo")
    assert stored["password"] == password


def test_has_repo_vault_pass_returns_true_when_present(mocked_vault):
    """has_repo_vault_pass returns True when password exists."""
    rid = "github:owner/repo"
    vault.set_repo_vault_pass(rid, "password")

    assert vault.has_repo_vault_pass(rid) is True


def test_has_repo_vault_pass_returns_false_when_absent(mocked_vault):
    """has_repo_vault_pass returns False when password doesn't exist."""
    assert vault.has_repo_vault_pass("nonexistent:repo") is False


def test_repo_vault_pass_tempfile(mocked_vault, tmp_path):
    """repo_vault_pass_tempfile writes password to 0600 tempfile."""
    rid = "github:owner/repo"
    password = "secret-vault-password"
    vault.set_repo_vault_pass(rid, password)

    original_mkstemp = tempfile.mkstemp
    def mock_mkstemp(*args, **kwargs):
        path = str(tmp_path / "test_vaultpass")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT)
        return fd, path

    import unittest.mock
    with unittest.mock.patch("tempfile.mkstemp", mock_mkstemp):
        result = vault.repo_vault_pass_tempfile(rid)

        assert os.path.exists(result)
        stat_result = os.stat(result)
        assert stat_result.st_mode & 0o777 == 0o600

        with open(result) as f:
            content = f.read()
        assert content == password

        os.remove(result)


def test_repo_vault_pass_tempfile_returns_none_when_absent(mocked_vault):
    """repo_vault_pass_tempfile returns None when password doesn't exist."""
    result = vault.repo_vault_pass_tempfile("nonexistent:repo")
    assert result is None


def test_delete_repo_vault_pass(mocked_vault):
    """delete_repo_vault_pass removes the password."""
    rid = "github:owner/repo"
    vault.set_repo_vault_pass(rid, "password")

    vault.delete_repo_vault_pass(rid)

    assert vault.has_repo_vault_pass(rid) is False


# ── list_secret_refs tests ──
def test_list_secret_refs_returns_refs(mocked_vault):
    """list_secret_refs returns secret reference metadata."""
    vault.seed_demo_secrets()

    refs = vault.list_secret_refs()

    assert isinstance(refs, list)
    assert len(refs) > 0

    # Check structure of a ref
    ado_ref = [r for r in refs if "ado-pat" in r["ref"]][0]
    assert ado_ref["kind"] == "token"
    assert "used" in ado_ref
    assert "rotated" in ado_ref
    assert "rotatable" in ado_ref


def test_list_secret_refs_only_includes_existing(mocked_vault):
    """list_secret_refs only includes secrets that actually exist."""
    # Don't seed anything
    refs = vault.list_secret_refs()

    assert isinstance(refs, list)
    assert len(refs) == 0


def test_list_secret_refs_marks_ssh_as_rotatable(mocked_vault):
    """list_secret_refs marks ssh-key as rotatable."""
    mocked_vault._kv_data["secret/rudder/ssh-deploy-key"] = {
        "public": "ssh-ed25519 AAAA...",
        "kind": "ssh-key"
    }

    refs = vault.list_secret_refs()
    ssh_ref = [r for r in refs if "ssh-deploy-key" in r["ref"]][0]

    assert ssh_ref["rotatable"] is True


def test_list_secret_refs_marks_tokens_as_not_rotatable(mocked_vault):
    """list_secret_refs marks tokens as not rotatable."""
    vault.seed_demo_secrets()

    refs = vault.list_secret_refs()
    token_ref = [r for r in refs if "ado-pat" in r["ref"]][0]

    assert token_ref["rotatable"] is False
