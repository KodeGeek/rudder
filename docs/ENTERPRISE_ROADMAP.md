# Rudder — Enterprise Readiness Roadmap

> Status of this document: a candid assessment of where Rudder stands as an
> enterprise product, and the path to close the gaps. Generated from a
> multi-dimension code review and pressure-tested with an adversarial critique.

## Where Rudder is today

Rudder has genuinely good bones — write-only secrets in Vault, encryption at
rest, no secrets in Git, a fault-tolerant UI that tolerates backend outages, and
segmented one-container-per-component packaging. But today it is squarely a
**single-tenant, trusted-network deployment**, not yet an enterprise product.

**Overall readiness: 1 / 5.**

| Score | Dimension | The gap in one line |
|:--:|---|---|
| 0/5 | Identity & access | Every API route is open — no auth, anyone reachable can inject SSH keys, trigger runs, delete repos |
| 0/5 | Multi-tenancy | No tenant model at any layer |
| 1/5 | Execution & scale | Runs are unbounded threads in the API process; single replica, no HA |
| 1/5 | Audit & compliance | No audit trail; actions can't be attributed |
| 1/5 | Notifications | No notification engine |
| 1/5 | Quality / CI | Zero automated tests, no CI pipeline, unpinned deps |
| 2/5 | Persistence | State is JSON files written non-atomically; run logs rewrite the whole file per line |
| 2/5 | Secrets / KMS | Vault uses an unscoped root token persisted plaintext on a shared volume |
| 2/5 | Security & supply chain | Containers run as root; no NetworkPolicy / Pod Security; `StrictHostKeyChecking=no` |
| 2/5 | Observability | Job metrics exist, but no self-metrics, tracing, or alert rules |
| 2/5 | API surface | No versioning, pagination, rate limiting |
| 2/5 | Reliability / ops | Raw kustomize tied to one k3s node; no graceful shutdown |
| 2/5 | Frontend UX | No auth-aware UI, no RBAC gating, minimal a11y |
| 2/5 | Docs / adoption | Good README; missing admin/install/upgrade/runbook docs |
| 2/5 | Portable deploy | No Helm chart, no published images, hardcoded NodePort + storage class |

### The blockers that gate everything

1. **No authentication** on any of the ~19 control-plane routes. This nullifies
   the otherwise-good write-only secret design — anyone with network reach can
   `POST /repos/credentials`.
2. **Unsafe persistence.** State is JSON files written non-atomically; the run-log
   path rewrites the entire runs file on every streamed log line under a global
   lock — a corruption and throughput risk.
3. **No multi-tenancy** at any layer.
4. **No published artifacts** — no Helm chart, no public images, hardcoded
   single-node assumptions, so there is no one-command deploy to AKS/EKS/GKE.
5. **No supply-chain / quality floor** — zero tests, no CI, unpinned deps, root
   containers.
6. **No audit trail or run attribution.**

## The roadmap

The dimensions are **not independent**. Identity is a prerequisite for RBAC,
multi-tenancy, audit attribution, and any safe exposure. A transactional
datastore is a prerequisite for tenant isolation, run-history integrity, audit
immutability, and horizontal scale. So the roadmap is deliberately ordered:
harden the foundation first, make it portable, then govern, then scale.

### M1 — Trust Floor *(in progress)*
Make Rudder safe to expose beyond localhost and safe against data loss.
- API authentication: a shared `RUDDER_API_KEY` guarding all routes, with a
  localhost/unset fallback so existing single-host installs keep working. Real
  SSO/OIDC is delegated to an authenticating reverse proxy (oauth2-proxy).
- Persistence on **SQLite (WAL)** behind a data layer — run logs become appended
  rows (kills the whole-file-rewrite storm), with a one-time migration from the
  JSON files. Postgres becomes a later swap for HA.
- **Bounded run queue** with backpressure — runs no longer spawn unbounded
  threads inside the API process.
- **SSH host-key trust** — managed `known_hosts` (trust-on-first-use) instead of
  blindly accepting any host key.
- First **CI** (compile, typecheck, build, **secret scan**) + first tests +
  pinned dependencies.

### M2 — Portable one-command deploy
A published **Helm chart** + public **multi-arch images** (GHCR) that install
cleanly on docker-compose, vanilla k8s, and AKS / EKS / GKE / OpenShift without
editing manifests. Parameterized storage class, service type (NodePort /
LoadBalancer / Ingress / Gateway API), optional host-stats; cloud value overlays;
`helm test` smoke check; copy-paste install per target.

### M3 — Operability & observability
Native `/metrics` for the control-plane itself, liveness/readiness split,
structured logging with trace IDs, a notification dispatcher
(Slack/Teams/email/webhook with per-job routing), Prometheus alert rules, and
graceful shutdown/drain.

### M4 — Governance: RBAC, audit & compliance
Promote the shared key into roles (admin/operator/viewer), an append-only audit
log with run attribution, real secret rotation, a scoped (non-root) Vault token,
non-root containers + NetworkPolicy + Pod Security Standards, and a
`COMPLIANCE.md` mapping SOC2 / ISO 27001 controls to features.

### M5 — Multi-tenancy & horizontal scale (HA)
Tenant isolation across data/secrets/jobs/runs/metrics/audit, the SQLite→Postgres
swap, leader-election for the scheduler, `replicas >= 2` with RollingUpdate,
per-tenant quotas, and API versioning + pagination.

## Known follow-ups (tracked, not yet scheduled)

Surfaced by the adversarial review and deferred deliberately:
- **SCIM / directory provisioning** and group→role sync (deprovisioning).
- **Data export / GDPR** right-to-erasure (tension with append-only audit).
- **Open-core boundary**: licensing tiers, entitlements, usage metering.
- **Support model**: supported-version windows, CVE/patch SLAs, coordinated
  disclosure, vuln intake.
- **DR**: defined RTO/RPO, restore drills, `PodDisruptionBudget`.
- **Vault production custody**: KMS auto-unseal, raise unseal threshold from
  1-of-1, move off the plaintext root token, TLS.
- **Accessibility (WCAG / Section 508)** as a procurement gate.

---

*Effort is non-trivial: realistically M1 and M2 are large, M3–M5 larger. The
ordering minimizes rework — each milestone lands on a stable, tested substrate
rather than being retrofitted.*
