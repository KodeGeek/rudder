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
| **1** | Web-UI (read-only observability) + containerized deployment | ✅ |
| **2** | Control-plane backend: Git providers + Vault + Ansible runner + reconcile loop + API; UI bound live | ✅ working (local e2e) |

The control-plane clones a Git repo, renders `ansible/jobs.yml` into a cron
schedule, runs **real Ansible** over SSH against hosts (auth via **Vault**), and
pushes metrics (Prometheus) + logs (Loki). The web-UI binds to its API live.
The full pipeline is verified end-to-end on Docker with a bundled Gitea + SSH
target so it runs with **zero external services or secrets**. GitHub and Azure
DevOps provider adapters are included — point at a real repo with a PAT.

## Quick start (Docker)

**UI only** (no backend — onboarding + empty states):

```bash
cp .env.example .env
docker compose up --build        # → http://localhost:8080
```

**Full stack** — control-plane + Ansible runner + Vault + bundled Gitea + SSH
target, every component its own container:

```bash
cp .env.example .env
echo "VAULT_DEV_TOKEN=$(openssl rand -hex 16)" >> .env   # shared dev token
echo "DATA_SOURCE=live" >> .env                          # bind the UI to the API
docker compose --profile bundled --profile backend up --build
# → http://localhost:8080 — connect the bundled repo (URL prefilled) and watch
#   the control-plane clone it, render the schedule, and run real Ansible jobs.
```

See **[deploy/DEPLOY.md](deploy/DEPLOY.md)** for Kubernetes, external
Prometheus/Loki/Vault, pointing at a real GitHub/Azure DevOps repo, and more.

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
├── deploy/                   DEPLOY.md · prometheus.yml · k8s/ (per-component manifests)
├── web-ui/                   Vite + React + TypeScript (read-only observability UI)
│   ├── Dockerfile            multi-stage: build → nginx
│   ├── nginx/                reverse-proxy template + runtime-config entrypoint
│   └── src/  components/ · screens/ · data/types · lib/{api,data,config,format}
├── control-plane/            Python/FastAPI: reconcile loop + Ansible runner + Vault + API
│   ├── app/                  config · vault · gitea · store · runner · telemetry · main
│   └── seed/                 sample fleet repo (jobs.yml + playbooks) seeded into Gitea
├── target/                   bundled sshd host real Ansible runs land on
└── gitea/                    bundled Git server bootstrap (init.sh)
```

Design notes and the full spec: [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

See [LICENSE](LICENSE).
