# Least-privilege Vault policy for the Rudder control-plane.
#
# The bundled deploy uses the root token for simplicity. In production, point
# Rudder at an external Vault and give it a SCOPED token instead of root:
#
#   vault policy write rudder deploy/vault/rudder-policy.hcl
#   vault token create -policy=rudder -period=72h
#   # set VAULT_TOKEN (or VAULT_TOKEN_FILE) to that token, NOT the root token.
#
# This confines Rudder to its own secret tree and a health check — a compromised
# control-plane token cannot read other apps' secrets or touch sys/* or auth/*.

# KV v2 secret data + metadata under the rudder/ prefix only.
path "secret/data/rudder/*" {
  capabilities = ["create", "read", "update", "delete"]
}
path "secret/metadata/rudder/*" {
  capabilities = ["read", "list", "delete"]
}

# Liveness/unseal check used by /metrics and /readyz.
path "sys/health" {
  capabilities = ["read"]
}
