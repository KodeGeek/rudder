<div align="center">

# Rudder

**A self-hostable GitOps control plane for scheduled Ansible automation.**

_Steer your fleet from Git. Cron meets Argo CD meets a status page — for Ansible._

</div>

---

Teams that manage servers with Ansible end up with a pile of cron jobs and no
visibility: did the nightly patch run? which host failed? why? **Rudder** runs
your infrastructure-as-code automation on a schedule, driven entirely by a Git
repo (**GitHub or Azure DevOps**) as the single source of truth, and gives you a
clean UI to see every job's status, history, and logs.

- **Everything-as-code, but observable.** Config lives in Git (auditable,
  PR-reviewed, reversible); you get a dashboard instead of `grep`-ing logs over SSH.
- **Read-only & honest.** The UI views status and triggers explicit runs — it
  never writes to Git, so it can't become a second, divergent source of truth.
- **Segmented & fault-isolated.** One container per component; the UI stays up
  and shows "stale / no data" even when every backend is down.
- **Self-hostable & offline-friendly.** Runs on your own box. The UI bundles all
  of its assets — **zero external network calls** at runtime.
- **Secrets stay in Vault.** SSH keys and secrets are referenced and rotated,
  never displayed.

## Status

| Phase | Scope | State |
|---|---|---|
| **1** | Web-UI (read-only observability) + containerized deployment | ✅ this repo |
| **2** | Control-plane backend: GitHub/Azure DevOps + Vault + Ansible runner + reconcile loop + API | 🔜 planned |

Phase 1 ships the full UI on a realistic **demo dataset** plus the deployment
scaffolding. The control-plane that makes the live integrations work is Phase 2;
the UI's data layer is shaped around the real contracts so it binds with no
redesign.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build        # → http://localhost:8080  (demo data)
```

Bring up the bundled, segmented backend stack (each its own container):

```bash
echo "VAULT_DEV_TOKEN=$(openssl rand -hex 16)" >> .env
docker compose --profile bundled up --build
```

See **[deploy/DEPLOY.md](deploy/DEPLOY.md)** for Kubernetes, external
Prometheus/Loki/Vault, and the full options.

## Develop the UI

```bash
cd web-ui
npm install
npm run dev          # Vite dev server
npm run build        # typecheck + production build → web-ui/dist
```

## Layout

```
rudder/
├── docker-compose.yml        segmented stack (profiles: bundled / backend / grafana)
├── deploy/
│   ├── DEPLOY.md             Docker + Kubernetes guide
│   ├── prometheus.yml
│   └── k8s/                  one Deployment+Service per component
└── web-ui/                   Vite + React + TypeScript (static, read-only UI)
    ├── Dockerfile            multi-stage: build → nginx
    ├── nginx/                reverse-proxy template + runtime-config entrypoint
    └── src/
        ├── components/  ui · icons · composite
        ├── screens/     Overview · Jobs · JobDetail · Manifest · Activity · Inventory · Settings
        ├── data/        types + demo dataset
        └── lib/         formatting + runtime config
```

Design notes and the full spec: [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

See [LICENSE](LICENSE).
