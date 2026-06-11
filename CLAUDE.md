# CLAUDE.md

Rudder — a self-hostable GitOps control plane for scheduled Ansible automation. A Git repo holding `jobs.yml` (+ optional `rudder.yml`) is the single source of truth; the control plane reconciles it into cron schedules, runs Ansible over SSH with Vault-held credentials, and ships metrics to Prometheus and logs to Loki.

## Architecture

- `control-plane/` — Python 3.12 + FastAPI (`app/main.py`). APScheduler cron, SQLite (WAL) state, hvac Vault client, API-key auth + RBAC (admin/operator/viewer). Key modules: `store.py`, `runner.py`, `vault.py`, `auth.py`, `host.py`.
- `web-ui/` — React 18 + TypeScript (strict) + Vite. Typed client `src/lib/api.ts` → `/api/control-plane/*` via nginx proxy. Zero external calls at runtime; degrades to stale/no-data when backends are down.
- `deploy/` — Helm chart, raw k8s manifests, INSTALL.md / DEPLOY.md. `vault/`, `gitea/`, `target/` — bundled services.
- `docs/CONFIG.md` is the reference for the `rudder.yml` settings block.

## Commands

```bash
# full stack
cp .env.example .env && docker compose --profile bundled --profile backend up --build   # UI :8080

# control-plane
cd control-plane && pip install -r requirements-dev.txt
pytest                                        # test suite
uvicorn app.main:app --reload --port 8090     # dev server

# web-ui
cd web-ui && npm run dev                      # :5173
npm run build                                 # tsc --noEmit + vite build
```

## Done means

`pytest` green (control-plane) · `npm run build` clean (web-ui) · no secrets committed (gitleaks CI) · README + `deploy/DEPLOY.md` updated in the same PR whenever behavior/config/deploy changes.

## Conventions

- Conventional Commits; branches `feat/` | `fix/` | `docs/`; small single-purpose PRs.
- Secrets live ONLY in Vault (credential API is write-only) — never in Git, code, or committed `.env`.
- No new heavy dependencies without discussion. No linter configs — match the surrounding style; TS is `strict`.
- Job manifests: `jobs.yml` (name, cron, playbook, limit, kind: task|dsc); operational tuning via the `rudder.yml` `settings:` block.
