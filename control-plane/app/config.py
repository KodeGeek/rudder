"""Environment configuration for the Rudder control-plane."""
import os


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# ── API auth ──
# Shared API key guarding all endpoints. When unset (and RUDDER_API_KEYS empty),
# the API is open (localhost / community fallback) — set this (from a Secret) for
# any non-localhost exposure. RUDDER_API_KEY is treated as an admin key.
API_KEY = env("RUDDER_API_KEY", "")
# Optional RBAC: comma-separated "key:role" pairs, role in {admin,operator,viewer}.
# e.g. RUDDER_API_KEYS="k1:admin,k2:operator,k3:viewer". Real SSO/OIDC is delegated
# to an authenticating reverse proxy, whose identity header is used for attribution.
API_KEYS = env("RUDDER_API_KEYS", "")

# ── Vault (OpenBao) ──
VAULT_ADDR = env("VAULT_ADDR", "http://vault:8200")
VAULT_TOKEN = env("VAULT_TOKEN", "")
# Auto-unseal mode generates the root token at init; the unseal sidecar writes it
# here. Used only when VAULT_TOKEN env is unset.
VAULT_TOKEN_FILE = env("VAULT_TOKEN_FILE", "")
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

# ── SSH host-key trust ──
# Persisted known_hosts on the work volume. Default policy is trust-on-first-use
# (accept-new): unknown hosts are pinned on first contact, but a later key change
# (MITM) is rejected. SSH_STRICT=true requires hosts to be pre-populated.
SSH_KNOWN_HOSTS = env("SSH_KNOWN_HOSTS", "/app/work/known_hosts")
SSH_STRICT = env("SSH_STRICT", "false").lower() == "true"

# ── Ansible run target (bundled sshd container) ──
TARGET_HOST = env("TARGET_HOST", "target")
TARGET_USER = env("TARGET_USER", "rudder")
TARGET_PORT = env("TARGET_PORT", "22")

def _seconds(s: str, default: int) -> int:
    """Parse a duration like '30m' / '2h' / '90s' / '120' into seconds."""
    s = (s or "").strip().lower()
    try:
        if s.endswith("m"):
            return int(s[:-1]) * 60
        if s.endswith("h"):
            return int(s[:-1]) * 3600
        if s.endswith("s"):
            return int(s[:-1])
        return int(s)
    except ValueError:
        return default


# ── Run execution (bounded worker pool + backpressure) ──
RUN_WORKERS = int(env("RUN_WORKERS", "4"))        # concurrent playbook runs
RUN_QUEUE_MAX = int(env("RUN_QUEUE_MAX", "20"))   # total in-flight (running+queued) before 429
# Hard per-run timeout: a playbook still running after this is SIGKILLed (whole
# process group, incl. ssh children) so a hung run can't execute indefinitely.
# Accepts 30m / 2h / 90s / seconds; set to 0 to disable.
RUN_TIMEOUT = env("RUN_TIMEOUT", "30m")
RUN_TIMEOUT_SECONDS = _seconds(RUN_TIMEOUT, 1800)

# ── Host reachability probe (Inventory up/down) ──
# A host is "up" if a TCP connect to its SSH/management port succeeds. To stop
# transient blips from flapping active↔disconnected: retry within a probe, and
# only flip a previously-up host to down after several CONSECUTIVE failed probes.
HOST_PROBE_INTERVAL = int(env("HOST_PROBE_INTERVAL", "60"))   # seconds between probe rounds
HOST_PROBE_TIMEOUT = float(env("HOST_PROBE_TIMEOUT", "3"))    # per TCP connect attempt
HOST_PROBE_ATTEMPTS = int(env("HOST_PROBE_ATTEMPTS", "2"))    # attempts per probe before it counts as a failure
HOST_DOWN_AFTER = int(env("HOST_DOWN_AFTER", "3"))            # consecutive failed probes before marking down

# ── Reconcile + state ──
RECONCILE_INTERVAL = env("RECONCILE_INTERVAL", "2m")
WORKDIR = env("WORKDIR", "/app/work")
STATE_FILE = env("STATE_FILE", "/app/work/repos.json")
RUNS_FILE = env("RUNS_FILE", "/app/work/runs.json")
DB_FILE = env("DB_FILE", "/app/work/rudder.db")
SEED_DIR = env("SEED_DIR", "/app/seed")
