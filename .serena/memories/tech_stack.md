# Tech Stack

- control-plane: Python 3.12, FastAPI + uvicorn, APScheduler (cron triggers), SQLite WAL (state/runs/run_logs/audit), hvac (Vault/OpenBao client), prometheus client. No mypy or linter configured.
- web-ui: React 18 + TypeScript (strict) + Vite, react-grid-layout, Geist fonts. No ESLint/Prettier, no heavy UI framework. Node 20 in CI.
- Infra: docker compose (profiles bundled/backend/grafana), OpenBao (encrypted file storage + vault-unseal sidecar, NOT dev mode), Gitea, Prometheus + Pushgateway, Loki, optional Grafana. Helm chart + raw k8s manifests in deploy/.
- CI (.github/workflows): ci.yml = pytest (py3.12) + tsc/vite build (node20) + docker image builds (no push) + gitleaks v8.18.4 binary; release.yml = multi-arch (amd64/arm64) → GHCR for web-ui/control-plane/target on v* tags.