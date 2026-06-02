"""Environment configuration for the Rudder control-plane."""
import os


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# ── Vault (OpenBao) ──
VAULT_ADDR = env("VAULT_ADDR", "http://vault:8200")
VAULT_TOKEN = env("VAULT_TOKEN", "")
VAULT_KV_MOUNT = env("VAULT_KV_MOUNT", "secret")
SSH_KEY_VAULT_PATH = env("SSH_KEY_VAULT_PATH", "rudder/ssh-deploy-key")

# ── Telemetry sinks ──
PUSHGATEWAY_URL = env("PUSHGATEWAY_URL", "http://pushgateway:9091")
LOKI_URL = env("LOKI_URL", "http://loki:3100")

# ── Bundled Gitea (seeded demo source) ──
GITEA_URL = env("GITEA_URL", "http://gitea:3000")
GITEA_TOKEN_FILE = env("GITEA_TOKEN_FILE", "/shared/gitea-token")
GITEA_ADMIN_USER = env("GITEA_ADMIN_USER", "rudder")
GITEA_ORG = env("GITEA_ORG", "rudder")
GITEA_REPO = env("GITEA_REPO", "fleet")
GITEA_SEED = env("GITEA_SEED", "true").lower() == "true"
BUNDLED_REPO_URL = env("BUNDLED_REPO_URL", f"{GITEA_URL}/{GITEA_ORG}/{GITEA_REPO}.git")

# ── Ansible run target (bundled sshd container) ──
TARGET_HOST = env("TARGET_HOST", "target")
TARGET_USER = env("TARGET_USER", "rudder")
TARGET_PORT = env("TARGET_PORT", "22")

# ── Reconcile + state ──
RECONCILE_INTERVAL = env("RECONCILE_INTERVAL", "2m")
WORKDIR = env("WORKDIR", "/app/work")
STATE_FILE = env("STATE_FILE", "/app/work/repos.json")
SEED_DIR = env("SEED_DIR", "/app/seed")
