<div align="center">

# Rudder

**A self-hostable GitOps control plane for scheduled Ansible automation.**

_Steer your fleet from Git. Cron meets Argo CD meets a status page — for Ansible._

</div>

---

<img width="1167" height="1125" alt="image" src="https://github.com/user-attachments/assets/29478dc5-cf82-47c4-b0e4-ed7624f01540" />

## What it is

Rudder runs your Ansible automation **on a schedule, driven entirely by a Git
repo** (GitHub or Azure DevOps) as the single source of truth — and gives you a
clean web UI to see every job's status, history, and logs.

You commit a small `jobs.yml` that declares *which playbook runs, where, and
when*. Rudder clones the repo, turns each entry into a cron schedule, runs **real
Ansible over SSH** using credentials kept in **Vault** (never in Git, never on
screen), and ships metrics to **Prometheus** and logs to **Loki**. Edit the
manifest, open a PR, merge — the schedule reconciles itself on the next pull.

Think of it as **cron + Argo-CD-style GitOps + a status page**, purpose-built for
Ansible: self-hosted, fully containerized, and with **no secrets ever in Git**.

## Why it exists

Teams that manage servers with Ansible usually end up with a pile of `crontab`
entries scattered across a control node, and no real visibility: *Did the nightly
patch run? Which host failed? Why? When did it last succeed?* Logs live in SSH
sessions, secrets live in files next to the playbooks, and the "schedule" is
whatever someone typed into `crontab -e` six months ago.

Rudder fixes that without asking you to rewrite your playbooks:

- **Everything-as-code, but observable.** The schedule lives in Git — auditable,
  PR-reviewed, reversible. You get a dashboard instead of `grep`-ing logs over SSH.
- **Honest by design.** The UI views status and triggers explicit runs; it never
  writes to Git, so it can't become a second, divergent source of truth.
- **Secrets stay in Vault — encrypted at rest.** SSH keys and ansible-vault
  passwords are **write-only**: set or replaced, never displayed or returned, and
  never committed. They're encrypted at rest and persist across restarts.
- **Segmented & fault-isolated.** One container per component; the UI stays up and
  shows "stale / no data" even when every backend is down.
- **Self-hostable & offline-friendly.** Runs on your own box. The UI bundles all
  of its assets — **zero external network calls** at runtime.

## Who it's for

- **Homelab operators & self-hosters** running playbooks on a schedule across a
  handful (or a rack) of hosts — patching, container deploys, drift correction,
  health checks — who want a UI and proper secret handling instead of raw cron.
- **Small platform / ops teams** that already use Ansible and want GitOps + an
  audit trail + observability for their scheduled automation, without standing up
  and operating a heavyweight tower.
- **Anyone** who needs *scheduled* configuration management, driven from Git, with
  secrets that never touch the repo and a clear record of what ran and when.

It is **not** a replacement for ad-hoc `ansible-playbook` runs, nor for
large-scale enterprise platforms (AWX/Tower, Rundeck) with RBAC, multi-tenancy,
and workflow graphs. Rudder deliberately stays small: *Git is the schedule, Vault
holds the secrets, and the UI shows you what happened.*

## How it works

```
 Git repo (jobs.yml)          Rudder control-plane                Your fleet
 ┌──────────────────┐   pull   ┌─────────────────────┐   ssh +    ┌──────────┐
 │ jobs.yml         │ ───────▶ │ reconcile → cron     │  ansible   │ host A   │
 │ playbooks/       │          │ scheduler → runner   │ ─────────▶ │ host B   │
 │ inventory        │          │ secrets ← Vault      │            │  …       │
 └──────────────────┘          └─────────┬───────────┘            └──────────┘
                                          │ metrics → Prometheus
                                          │ logs    → Loki
                                          ▼
                                   Web UI (status, history, logs)
```

The manifest is just a list of scheduled runs:

```yaml
# ansible/jobs.yml  (a bare list, or under a `jobs:` / `scheduled_jobs:` key)
- name: nightly-patching
  cron: "0 3 * * *"
  playbook: playbooks/patch.yml
  limit: ubuntuservers        # an inventory group, host, or "all"
  desc: Apply security updates across the fleet.

- name: deploy-adguard
  cron: "0 * * * *"
  playbook: playbooks/adguard.yml
  limit: dockerservers
```

Rudder reads your **existing Ansible inventory** from the repo, bundles the common
collections (`community.docker`, `community.general`, `ansible.posix`) and
installs any `requirements.yml`, and authenticates to your hosts with an SSH key
you store once via the UI. Per-repo run credentials (SSH private key +
ansible-vault password) are pasted into the **Credentials** screen — write-only,
straight into Vault.

## Quick start (Docker)

**UI only** — onboarding + empty states, no backend:

```bash
cp .env.example .env
docker compose up --build              # → http://localhost:8080
```

**Full stack** — control-plane + Ansible runner + Vault + bundled Gitea + SSH
target, every component in its own container. The bundled Vault now uses
encrypted file storage and **auto-unseals itself** — no token to set:

```bash
cp .env.example .env
echo "DATA_SOURCE=live" >> .env         # bind the UI to the live API
docker compose --profile bundled --profile backend up --build
# → http://localhost:8080 — connect the prefilled bundled repo and watch the
#   control-plane clone it, render the schedule, and run real Ansible jobs.
```

Point it at **your own** GitHub / Azure DevOps repo from the **Settings → Connect**
screen (public, access token, or deploy key). See
**[deploy/DEPLOY.md](deploy/DEPLOY.md)** for Kubernetes, external
Prometheus/Loki/Vault, and production notes.

## Security

Rudder holds fleet credentials and can run Ansible against your hosts — treat it
as privileged infrastructure. Secrets live only in Vault (encrypted at rest,
write-only, never in Git or on screen), and nothing sensitive is ever committed.

**Before exposing it beyond a trusted host, read [SECURITY.md](SECURITY.md).** In
short: the API has no built-in auth and the bundled stack speaks plain HTTP, so
put it behind a VPN / SSO / authenticating reverse proxy with TLS, and use a real
sealed Vault for production.

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
├── vault/                    bundled Vault config + auto-unseal sidecar (encrypted persistence)
├── target/                   bundled sshd host real Ansible runs land on
└── gitea/                    bundled Git server bootstrap (init.sh)
```

Design notes and the full spec: [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

See [LICENSE](LICENSE).
