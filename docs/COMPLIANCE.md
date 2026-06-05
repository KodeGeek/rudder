# Rudder — Security & Compliance Mapping

How Rudder's features map to common control frameworks (SOC 2 Trust Services
Criteria and ISO/IEC 27001:2022 Annex A). This is an engineering mapping to aid
an audit, not a certification.

## Access control & identity

| Control | SOC 2 | ISO 27001 | How Rudder addresses it |
|---|---|---|---|
| Authentication | CC6.1 | A.5.15, A.8.5 | All API routes require a key (`RUDDER_API_KEY`); SSO via an authenticating reverse proxy (OIDC/SAML). |
| Authorization (RBAC) | CC6.1, CC6.3 | A.5.15, A.5.18 | Roles admin/operator/viewer (`RUDDER_API_KEYS`); writes require operator+, secrets/deletes require admin; UI hides controls by role. |
| Least privilege (secrets) | CC6.1 | A.8.2 | Scoped Vault policy (`deploy/vault/rudder-policy.hcl`) confines the control-plane to `secret/rudder/*`; secrets are write-only and never returned. |
| Session management | CC6.1 | A.8.5 | Bearer token in the UI; 401 forces re-auth; sign-out clears the token. |

## Auditability

| Control | SOC 2 | ISO 27001 | How Rudder addresses it |
|---|---|---|---|
| Audit logging | CC7.2, CC7.3 | A.8.15 | Append-only `audit` table records every mutation (who/role/action/target/source-IP/time); echoed as structured logs for SIEM shipment; surfaced in the UI (admin). |
| Change traceability | CC8.1 | A.8.32 | The schedule + alerting live in Git (GitOps); reconcile pulls and re-renders — every change is a reviewed, reversible commit. |
| Monitoring | CC7.1, CC7.2 | A.8.16 | Self-metrics at `/metrics` + Prometheus alert rules (control-plane/vault down, reconcile stalled, job failing); per-run metrics to Prometheus and logs to Loki. |

## Cryptography & data protection

| Control | SOC 2 | ISO 27001 | How Rudder addresses it |
|---|---|---|---|
| Secrets at rest | CC6.1 | A.8.24 | SSH keys / tokens / vault passwords stored encrypted in Vault (OpenBao file storage), never in Git. |
| Key rotation | CC6.1 | A.8.24 | The Rudder-managed run SSH key rotates on demand (admin) with a recorded timestamp; operator secrets rotate by re-submission. |
| Transport security | CC6.7 | A.8.20, A.8.21 | TLS terminated at the reverse proxy/Ingress; SSH host keys pinned (trust-on-first-use), no blanket `StrictHostKeyChecking=no`. |
| Supply chain | CC7.1 | A.8.28, A.8.30 | Pinned Python deps + external image digests; CI runs a secret scan (gitleaks); images published multi-arch from source. |

## Operations & resilience

| Control | SOC 2 | ISO 27001 | How Rudder addresses it |
|---|---|---|---|
| Availability / DR | A1.2 | A.8.13, A.8.14 | State on persistent volumes; SQLite backup/restore (see RUNBOOK); graceful shutdown drains runs; probes gate traffic. |
| Hardening | CC6.6, CC6.8 | A.8.9 | Container `securityContext` (no privilege escalation, dropped capabilities, RuntimeDefault seccomp); optional NetworkPolicy segmentation; non-root opt-in. |
| Incident response | CC7.3, CC7.4 | A.5.24–A.5.26 | RUNBOOK with alert→response procedures; audit trail for forensics. |

## Known gaps (roadmap)

These are deliberately not yet implemented and are tracked in
[ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md):

- **SCIM / directory provisioning** and group→role sync (deprovisioning).
- **Data export / right-to-erasure** (GDPR) — tension with append-only audit to resolve.
- **Multi-tenancy** isolation and per-tenant Vault policies (M5).
- **Vault production custody**: KMS auto-unseal, raise the 1-of-1 unseal threshold,
  move fully off the root token, TLS to Vault.
- **Non-root by default** across all components (currently opt-in for Rudder's images).
