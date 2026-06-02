# Bundled OpenBao — PRODUCTION file storage. Secrets are encrypted at rest
# (AES-256-GCM behind the barrier key) and PERSIST across restarts, unlike the
# old `-dev` in-memory mode. The vault-unseal sidecar auto-unseals on boot.
#
# TLS is disabled here on purpose: the bundled stack is meant to run on a trusted
# network behind a reverse proxy that terminates HTTPS. Do not expose :8200
# directly. See SECURITY.md.

storage "file" {
  path = "/openbao/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = "true"
}

api_addr      = "http://vault:8200"
disable_mlock = true
ui            = false
