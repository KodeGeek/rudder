"""Vault (OpenBao) integration: SSH keypair + secret references.

The SSH keypair used to authenticate Ansible runs is generated once and stored
in Vault. The private key never leaves the control-plane (written to a 0600
tempfile per run); the public key is published so the target can authorize it.
Secret *values* are never returned to the API/UI — only reference metadata.
"""
import os
import subprocess
import tempfile
import time

import hvac

from . import config

_client = None
_client_token = None


def _read_token() -> str:
    """Vault token from env, or from the file the unseal sidecar publishes
    (auto-unseal mode generates the root token at init time)."""
    if config.VAULT_TOKEN:
        return config.VAULT_TOKEN
    f = config.VAULT_TOKEN_FILE
    if f and os.path.exists(f):
        try:
            return open(f).read().strip()
        except OSError:
            return ""
    return ""


def client() -> "hvac.Client":
    # Rebuild if the token first appears or changes — the token file may not
    # exist yet when the control-plane boots, then the sidecar publishes it.
    global _client, _client_token
    tok = _read_token()
    if _client is None or tok != _client_token:
        _client = hvac.Client(url=config.VAULT_ADDR, token=tok)
        _client_token = tok
    return _client


def wait_ready(timeout: int = 90) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            c = client()
            if c.sys.is_initialized() and not c.sys.is_sealed():
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def is_up() -> bool:
    """Cheap reachability/unseal check for /metrics and /readyz."""
    try:
        c = client()
        return bool(c.sys.is_initialized()) and not c.sys.is_sealed()
    except Exception:
        return False


def _kv_read(path: str):
    try:
        r = client().secrets.kv.v2.read_secret_version(
            path=path, mount_point=config.VAULT_KV_MOUNT, raise_on_deleted_version=False
        )
        return r["data"]["data"]
    except Exception:
        return None


def _kv_write(path: str, data: dict):
    client().secrets.kv.v2.create_or_update_secret(
        path=path, secret=data, mount_point=config.VAULT_KV_MOUNT
    )


def ensure_ssh_key() -> dict:
    """Generate an ed25519 keypair in Vault if absent; return {private, public}."""
    existing = _kv_read(config.SSH_KEY_VAULT_PATH)
    if existing and existing.get("private") and existing.get("public"):
        return existing
    d = tempfile.mkdtemp()
    kf = os.path.join(d, "id")
    subprocess.run(
        ["ssh-keygen", "-t", "ed25519", "-N", "", "-f", kf, "-C", "rudder-deploy-key"],
        check=True, capture_output=True,
    )
    priv = open(kf).read()
    pub = open(kf + ".pub").read().strip()
    _kv_write(config.SSH_KEY_VAULT_PATH, {"private": priv, "public": pub})
    try:
        os.remove(kf); os.remove(kf + ".pub"); os.rmdir(d)
    except OSError:
        pass
    return {"private": priv, "public": pub}


def public_key() -> str:
    data = _kv_read(config.SSH_KEY_VAULT_PATH)
    return (data or {}).get("public", "")


def private_key_tempfile() -> str:
    data = _kv_read(config.SSH_KEY_VAULT_PATH)
    if not data or not data.get("private"):
        raise RuntimeError("SSH private key not found in Vault")
    fd, path = tempfile.mkstemp(prefix="rudder_key_")
    with os.fdopen(fd, "w") as f:
        f.write(data["private"])
    os.chmod(path, 0o600)
    return path


def seed_demo_secrets():
    """Seed a few reference-only secrets so the UI's Vault panel has content.
    Values are placeholders and are never returned to the browser."""
    refs = {
        "ado-pat": {"kind": "token"},
        "github-app": {"kind": "app-creds"},
        "registry-pull": {"kind": "token"},
    }
    for name, meta in refs.items():
        if _kv_read(f"rudder/{name}") is None:
            _kv_write(f"rudder/{name}", {"value": "(placeholder)", **meta})


def _repo_path(rid: str) -> str:
    safe = rid.replace(":", "_").replace("/", "_")
    return f"rudder/repo-creds/{safe}"


def set_repo_token(rid: str, token: str):
    _kv_write(_repo_path(rid), {"token": token})


def get_repo_token(rid: str):
    d = _kv_read(_repo_path(rid))
    return (d or {}).get("token")


def delete_repo_token(rid: str):
    try:
        client().secrets.kv.v2.delete_metadata_and_all_versions(
            path=_repo_path(rid), mount_point=config.VAULT_KV_MOUNT)
    except Exception:
        pass


def _deploy_path(rid: str) -> str:
    safe = rid.replace(":", "_").replace("/", "_")
    return f"rudder/repo-deploy-keys/{safe}"


def ensure_repo_deploy_key(rid: str) -> str:
    """Generate a per-repo ed25519 deploy keypair in Vault if absent; return the
    PUBLIC key (the operator adds it to the repo's deploy keys)."""
    d = _kv_read(_deploy_path(rid))
    if d and d.get("private") and d.get("public"):
        return d["public"]
    tmp = tempfile.mkdtemp()
    kf = os.path.join(tmp, "id")
    subprocess.run(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", kf, "-C", "rudder-deploy-key"],
                   check=True, capture_output=True)
    priv = open(kf).read()
    pub = open(kf + ".pub").read().strip()
    _kv_write(_deploy_path(rid), {"private": priv, "public": pub})
    for f in (kf, kf + ".pub"):
        try:
            os.remove(f)
        except OSError:
            pass
    try:
        os.rmdir(tmp)
    except OSError:
        pass
    return pub


def repo_deploy_public(rid: str):
    d = _kv_read(_deploy_path(rid))
    return (d or {}).get("public")


def repo_deploy_private_tempfile(rid: str) -> str:
    d = _kv_read(_deploy_path(rid))
    if not d or not d.get("private"):
        raise RuntimeError("deploy key not found in Vault")
    fd, path = tempfile.mkstemp(prefix="rudder_deploy_")
    with os.fdopen(fd, "w") as f:
        f.write(d["private"])
    os.chmod(path, 0o600)
    return path


def delete_repo_deploy_key(rid: str):
    try:
        client().secrets.kv.v2.delete_metadata_and_all_versions(
            path=_deploy_path(rid), mount_point=config.VAULT_KV_MOUNT)
    except Exception:
        pass


def _hostkey_path(rid: str) -> str:
    safe = rid.replace(":", "_").replace("/", "_")
    return f"rudder/repo-host-key/{safe}"


def set_repo_host_key(rid: str, private_key: str):
    _kv_write(_hostkey_path(rid), {"private": private_key})


def has_repo_host_key(rid: str) -> bool:
    return bool((_kv_read(_hostkey_path(rid)) or {}).get("private"))


def repo_host_key_tempfile(rid: str):
    """The SSH private key the operator's fleet authorizes (for real runs)."""
    d = _kv_read(_hostkey_path(rid))
    priv = (d or {}).get("private")
    if not priv:
        return None
    if not priv.endswith("\n"):
        priv += "\n"  # ssh refuses keys without a trailing newline
    fd, path = tempfile.mkstemp(prefix="rudder_hostkey_")
    with os.fdopen(fd, "w") as f:
        f.write(priv)
    os.chmod(path, 0o600)
    return path


def delete_repo_host_key(rid: str):
    try:
        client().secrets.kv.v2.delete_metadata_and_all_versions(
            path=_hostkey_path(rid), mount_point=config.VAULT_KV_MOUNT)
    except Exception:
        pass


def _vaultpass_path(rid: str) -> str:
    safe = rid.replace(":", "_").replace("/", "_")
    return f"rudder/repo-vault-pass/{safe}"


def set_repo_vault_pass(rid: str, password: str):
    _kv_write(_vaultpass_path(rid), {"password": password})


def has_repo_vault_pass(rid: str) -> bool:
    return bool((_kv_read(_vaultpass_path(rid)) or {}).get("password"))


def repo_vault_pass_tempfile(rid: str):
    """Write the repo's ansible-vault password to a 0600 tempfile for
    --vault-password-file, or return None if none is stored."""
    d = _kv_read(_vaultpass_path(rid))
    pw = (d or {}).get("password")
    if not pw:
        return None
    fd, path = tempfile.mkstemp(prefix="rudder_vaultpass_")
    with os.fdopen(fd, "w") as f:
        f.write(pw)
    os.chmod(path, 0o600)
    return path


def delete_repo_vault_pass(rid: str):
    try:
        client().secrets.kv.v2.delete_metadata_and_all_versions(
            path=_vaultpass_path(rid), mount_point=config.VAULT_KV_MOUNT)
    except Exception:
        pass


def list_secret_refs() -> list:
    names = ["ssh-deploy-key", "ado-pat", "github-app", "registry-pull"]
    out = []
    for n in names:
        data = _kv_read(f"rudder/{n}")
        if data is None:
            continue
        kind = data.get("kind") or ("ssh-key" if "ssh" in n else "token")
        out.append({
            "ref": f"vault/{n}",
            "used": 0,
            "rotated": int(time.time() * 1000),
            "kind": kind,
        })
    return out
