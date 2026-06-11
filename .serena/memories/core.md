# Rudder — Core Map

Self-hostable GitOps control plane for scheduled Ansible automation. A Git repo (GitHub/Azure DevOps/bundled Gitea) holding `jobs.yml` (+ optional `rudder.yml`) is the single source of truth; the control plane reconciles it into cron schedules, runs real Ansible over SSH with Vault-held credentials, pushes metrics to Prometheus (Pushgateway) and logs to Loki.

## Source map
- control-plane/ — Python FastAPI backend; for the module map, jobs.yml/rudder.yml shapes, and runtime invariants read `mem:control-plane/core`
- web-ui/ — React/Vite frontend; for screens, API client layout, and fault-isolation rules read `mem:web-ui/core`
- deploy/ — helm/ chart, k8s/ raw manifests, INSTALL.md (compose + kind/AKS/EKS/GKE), DEPLOY.md (prod notes, external Prom/Loki/Vault)
- vault/ (OpenBao file-backend config + auto-unseal sidecar), gitea/ (init.sh seeds admin + API token), target/ (sshd test host; pubkey from Vault)
- docs/ — CONFIG.md (rudder.yml reference — read for any settings question), RUNBOOK.md (day-2 ops), COMPLIANCE.md (RBAC matrix, SOC2/ISO mapping), ENTERPRISE_ROADMAP.md
- docker-compose.yml — profiles: bundled (vault, prometheus, pushgateway, loki), backend (gitea, control-plane, target), grafana (optional)

## Project-wide invariants
- Secrets live ONLY in Vault; credential API is write-only (returns "is set" flags, never values). Never in Git/code/UI. gitleaks enforced in CI.
- web-ui makes zero external network calls at runtime and must degrade to stale/no-data states when backends are down (fault isolation by design).
- Every mutation is audit-logged append-only (principal, role, action, timestamp, source IP).
- Docs-as-code: behavior/config/deploy changes must update README.md + deploy/DEPLOY.md in the same PR.

Stack/versions: `mem:tech_stack` · dev/run commands: `mem:suggested_commands` · style and PR rules: `mem:conventions` · definition of done: `mem:task_completion`