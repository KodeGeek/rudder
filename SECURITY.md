# Security

Rudder is a GitOps control plane that holds **fleet credentials** (SSH keys,
ansible-vault passwords, Git tokens) and can **run Ansible against your hosts**.
Treat it as a privileged piece of infrastructure. This document describes how
secrets are handled and the hardening you must do before exposing it.

## How secrets are handled (by design)

- **Nothing secret is ever committed.** Only `.env.example` is tracked (empty
  values); `.env`, work dirs, and Vault data are git-ignored. The persisted repo
  state (`repos.json`) never contains tokens, keys, or passwords.
- **Vault is the only store.** SSH keys, ansible-vault passwords, and Git tokens
  live in Vault/OpenBao KV-v2. The control-plane is Vault's only client.
- **Encrypted at rest, persisted across restarts.** The bundled Vault runs with
  file storage, so secrets are encrypted at rest (AES-256-GCM behind the barrier
  key) and survive container/host restarts — they are never written in plaintext.
- **Write-only credentials.** No API endpoint ever returns a secret value. The
  UI and API expose only boolean "configured" flags (`hostKey`, `vaultPass`,
  `auth`) and reference metadata. A secret can be **set or overwritten**, never
  read back — including by the operator.
- **Secrets touch disk only as `0600` tempfiles**, written immediately before a
  run/clone and removed in a `finally` block afterward.
- **No secret values on the command line.** Keys and vault passwords are passed
  by file path or env var, so they never appear in `ps`/argv. Clone-URL tokens
  are scrubbed from the git remote after clone, and credentials are redacted
  from error messages and logs (`//<credentials>@`).
- **No shell injection.** Every `git` / `ansible` / `ssh-keygen` call uses the
  argument-list form (no `shell=True`).

## You MUST do before exposing Rudder

These are intentional limits of the current release, not bugs. Rudder is safe to
run on a trusted host/network; harden the following before any wider exposure.

1. **Turn on authentication — it ships off by default.** With no `RUDDER_API_KEY`
   set, the API is open: anyone who can reach the UI (`:8080`) or the control-plane
   (`:8090`) can trigger playbook runs, add repos, and overwrite credentials (they
   still cannot *read* secrets). Set `RUDDER_API_KEY` to require a shared key with
   `admin` / `operator` / `viewer` roles (`RUDDER_API_KEYS`), and for real identity
   front it with a VPN, SSO, or an authenticating reverse proxy (OIDC/SAML). Until
   then, bind the ports to localhost / a private network — do **not** publish them
   to the internet.

2. **Terminate TLS.** The bundled stack speaks plain HTTP. Pasted keys and
   passwords travel browser → nginx → control-plane in clear text. Put an HTTPS
   reverse proxy in front before any non-localhost access.

3. **Understand the bundled Vault's auto-unseal tradeoff.** The bundled OpenBao
   uses file storage (encrypted at rest, persisted across restarts) and is
   **auto-unsealed** by the `vault-unseal` sidecar. To unseal without a human, the
   sidecar keeps the **unseal key + root token on a private Docker volume**
   (`vault-shared`, never in git). That means anyone with access to the host /
   that volume has both the ciphertext and the key. For a stricter posture:
   - **Manual unseal** — delete the `vault-unseal` service and unseal Vault by
     hand after each restart (the key never sits next to the data), **or**
   - **Real sealed Vault** — run a properly initialized Vault/OpenBao with
     KMS/HSM auto-unseal and give the control-plane a **scoped token/policy**
     (read/write only under `secret/rudder/*`), not a root token. The k8s
     manifests already source `VAULT_TOKEN` from a `Secret` you create
     out-of-band — point it at your real Vault.

   Also note `disable_mlock = true` in `vault/config.hcl` (set for container
   portability): Vault memory may be swapped to disk. Enable mlock (with the
   `IPC_LOCK` capability) if your host has swap and you want to avoid that.

## Notes / scope

- **The control-plane container runs as root.** Acceptable on a trusted single
  host; run it under an unprivileged user / restricted PodSecurity if your
  environment requires it.
- **Run logs are shipped to Loki and shown in the UI.** Rudder cannot redact a
  secret that a *playbook* chooses to print. Mark sensitive tasks with
  `no_log: true` in your Ansible.
- **The bundled Gitea** generates a random admin password and an API token at
  first boot (written to a shared volume, never committed); it has no published
  port and is reachable only on the internal compose network.

## Reporting

This is a community project shared as-is. If you find a vulnerability, **report it
privately** — open a GitHub [security advisory](https://github.com/KodeGeek/rudder/security/advisories/new)
rather than a public issue. Describe the impact and reproduction (without including
any real secrets); we'll coordinate a fix and disclosure.
