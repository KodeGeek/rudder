#!/bin/sh
# Auto-init + auto-unseal for the bundled OpenBao (file storage = encrypted at
# rest, persisted across restarts). No manual unseal step: this sidecar
# initializes Vault once, stores the unseal key + root token on a private Docker
# volume (never in git), and re-unseals automatically whenever Vault restarts.
#
# Convenience/auto-unseal tradeoff: anyone with access to the host volume has
# both the ciphertext and the unseal key. For a stricter posture, unseal
# manually instead. See SECURITY.md.
export BAO_ADDR="${BAO_ADDR:-http://vault:8200}"
KEYS=/vault-shared/init.txt          # raw `operator init` output (unseal key + root token)
TOKEN=/vault-shared/root-token       # just the root token, for the control-plane / target

log() { echo "vault-unseal: $*"; }
is_up()          { bao status >/dev/null 2>&1 || [ $? -eq 2 ]; }   # exit 2 = sealed but reachable
is_initialized() { bao status 2>/dev/null | grep -qiE '^Initialized[[:space:]]+true'; }
is_sealed()      { bao status 2>/dev/null | grep -qiE '^Sealed[[:space:]]+true'; }

i=0
while ! is_up; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { log "vault API never came up"; exit 1; }
  log "waiting for vault API…"; sleep 2
done

if ! is_initialized; then
  log "initializing vault (1 unseal key)…"
  bao operator init -key-shares=1 -key-threshold=1 > "$KEYS" 2>/dev/null
  chmod 600 "$KEYS"
fi

KEY=$(grep -i 'Unseal Key 1:' "$KEYS" | awk '{print $NF}')
ROOT=$(grep -i 'Initial Root Token:' "$KEYS" | awk '{print $NF}')
printf '%s' "$ROOT" > "$TOKEN"
chmod 600 "$TOKEN"
[ -n "$KEY" ] || { log "no unseal key found in $KEYS — aborting"; exit 1; }

# unseal now so we can configure the KV engine
n=0
while is_sealed && [ "$n" -lt 15 ]; do bao operator unseal "$KEY" >/dev/null 2>&1; n=$((n + 1)); sleep 1; done

# Enable the KV v2 engine the control-plane uses. `-dev` mode auto-mounts this at
# secret/; production mode does not. Idempotent: mounts once, then persists in
# storage across restarts.
export BAO_TOKEN="$ROOT"
if ! bao secrets list 2>/dev/null | grep -qE '^secret/'; then
  log "enabling kv-v2 at secret/"
  bao secrets enable -path=secret kv-v2 >/dev/null 2>&1 || log "kv-v2 enable failed"
fi

log "ready — root token published to $TOKEN; keeping vault unsealed"
while true; do
  if is_sealed; then
    log "vault is sealed → unsealing"
    bao operator unseal "$KEY" >/dev/null 2>&1 || log "unseal attempt failed"
  fi
  sleep 10
done
