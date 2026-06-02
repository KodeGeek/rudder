#!/bin/sh
# Fetch the Rudder deploy public key from Vault, authorize it for the target
# user, then run sshd. Polls until the control-plane has published the key.
set -e

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-}"
KV_MOUNT="${VAULT_KV_MOUNT:-secret}"
KEY_PATH="${SSH_KEY_VAULT_PATH:-rudder/ssh-deploy-key}"
USER_NAME="${TARGET_USER:-rudder}"
HOME_DIR="/home/${USER_NAME}"

id "$USER_NAME" >/dev/null 2>&1 || useradd -m -s /bin/bash "$USER_NAME"
mkdir -p "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.ssh"

echo "target: waiting for SSH public key in Vault ($KEY_PATH)…"
PUB=""
i=0
while [ -z "$PUB" ] && [ "$i" -lt 60 ]; do
  PUB=$(curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
    "$VAULT_ADDR/v1/$KV_MOUNT/data/$KEY_PATH" \
    | jq -r '.data.data.public // empty' 2>/dev/null || true)
  [ -z "$PUB" ] && sleep 3
  i=$((i + 1))
done

if [ -n "$PUB" ]; then
  echo "$PUB" > "$HOME_DIR/.ssh/authorized_keys"
  chmod 600 "$HOME_DIR/.ssh/authorized_keys"
  chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh"
  echo "target: authorized key installed for $USER_NAME"
else
  echo "target: WARNING — no key fetched from Vault; sshd will start unauthorized"
fi

mkdir -p /run/sshd
ssh-keygen -A >/dev/null 2>&1 || true
echo "target: starting sshd"
exec /usr/sbin/sshd -D -e
