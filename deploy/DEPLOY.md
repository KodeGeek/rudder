# Deploying Rudder

Rudder is shipped as a **segmented stack** — each component is its own
container so a failure in one never takes down the rest. The web-ui is a
static, **read-only** observability app; all configuration lives in Git.

```
        ┌── web-ui ──┐   read-only UI + same-origin proxy (no CORS)
        │            │
        ├─ proxies → ├─ /api/prometheus → Prometheus   (metrics §5.2)
        │            ├─ /api/loki        → Loki         (run logs §5.3)
        │            ├─ /api/vault       → Vault health check only (liveness pill)
        │            └─ /api/control-plane → control-plane (reconcile + API, Phase 2)
        └────────────┘
```

The web-ui never writes to Git. New schedules / config changes are made in
code (`ansible/jobs.yml`, `rudder.yml`) → PR → merge → the control-plane
reconciles. The UI only **views** and triggers explicit **runs**.

---

## Fault isolation

- One container per component, each with its own healthcheck + restart policy.
- The web-ui has **no hard dependency** on any backend. Its nginx proxy resolves
  upstreams *lazily* (DNS at request time), so it starts and stays up even when
  Prometheus / Loki / Vault / control-plane are all down — those calls just
  return 502/503 and the UI shows its "stale / no data" states.

## External vs bundled Prometheus / Loki / Vault

The UI reads its endpoints at runtime (no rebuild). Point them anywhere:

| Variable | What it is |
|---|---|
| `DATA_SOURCE` | `mock` (demo data) or `live` (bind real endpoints) |
| `PROMETHEUS_URL` | your Prometheus base URL |
| `LOKI_URL` | your Loki base URL |
| `VAULT_URL` | your Vault / OpenBao base URL |
| `CONTROL_PLANE_URL` | the control-plane API (Phase 2) |

Use your **own** Prometheus/Loki by setting those URLs and *not* starting the
bundled ones; or run the bundled copies with `--profile bundled`.

---

## Secrets

Nothing secret-shaped is committed to this repo, and nothing secret is ever
returned to the browser. See **[SECURITY.md](../SECURITY.md)** for the full model.

- `.env` is git-ignored — copy `.env.example` → `.env` and fill in non-secret
  bootstrap values (mode + endpoints). There is **no Vault token to set** for the
  bundled stack: the auto-unseal sidecar generates the root token at init and
  keeps it on a private volume.
- The bundled Vault (Docker) uses **encrypted file storage and auto-unseals**, so
  SSH keys and ansible-vault passwords are encrypted at rest and survive restarts.
- Per-repo run credentials (SSH private key, ansible-vault password, Git token)
  are **write-only**: pasted into the UI, stored in Vault, never displayed again.
- On Kubernetes the Vault token is read from a Secret you create out-of-band — it
  is never stored in a manifest.

For production, run a real sealed Vault/OpenBao with KMS/HSM auto-unseal and a
least-privilege policy for the control-plane (read/write under `secret/rudder/*`).

---

## Docker

```bash
cp .env.example .env             # set DATA_SOURCE + endpoints (no Vault token needed)

# just the UI (demo data, or external endpoints via .env)
docker compose up --build        # → http://localhost:8080

# UI + bundled vault / prometheus / pushgateway / loki
docker compose --profile bundled up --build

# FULL STACK (live): + control-plane, bundled Gitea (seeded), and an SSH target.
# The bundled Vault auto-unseals — just enable live mode:
echo "DATA_SOURCE=live" >> .env
docker compose --profile bundled --profile backend up --build
#   → http://localhost:8080 — connect the bundled repo (URL prefilled in the
#     wizard); the control-plane clones it and runs real Ansible jobs.

# optional grafana
docker compose --profile bundled --profile grafana up --build
```

### Point at a real GitHub / Azure DevOps repo

Connect a real repo from **Settings → Connect** (or `POST /api/control-plane/repos`).
It must contain a job manifest (`jobs.yml` anywhere in the repo — a bare list or
under a `jobs:` / `scheduled_jobs:` key) plus your playbooks and inventory.

- **Public repos** clone over HTTPS with no secret.
- **Private repos** authenticate with an access token (GitHub PAT or Azure DevOps
  PAT) or a generated **deploy key** — both stored write-only in Vault.
- **Run credentials** (the SSH private key your fleet authorizes + any
  ansible-vault password) are pasted into the **Credentials** screen, also
  write-only into Vault.

Plain Docker, pointed at external infra:

```bash
docker build -t rudder-web-ui web-ui
docker run --rm -p 8080:80 \
  -e DATA_SOURCE=live \
  -e PROMETHEUS_URL=https://prometheus.internal:9090 \
  -e LOKI_URL=https://loki.internal:3100 \
  -e VAULT_URL=https://vault.internal:8200 \
  rudder-web-ui
```

---

## Kubernetes

Manifests live in `deploy/k8s/` (one Deployment + Service per component,
probes, PVCs, and an optional Ingress). The **base** is secret-free:
web-ui (demo mode) + prometheus + loki.

```bash
# 1. build the UI image. Docker Desktop's K8s shares the local image store, so
#    IfNotPresent finds it. (kind: `kind load docker-image rudder-web-ui:latest`;
#    remote cluster: push to a registry and edit the image in 10-web-ui.yaml.)
docker build -t rudder-web-ui:latest web-ui

# 2. apply the base stack (namespace: rudder)
kubectl apply -k deploy/k8s

# 3. reach it
kubectl -n rudder port-forward svc/web-ui 8080:80   # → http://localhost:8080
```

### Add Vault (opt-in)

```bash
# create the dev token Secret out-of-band (never committed)
kubectl -n rudder create secret generic vault-dev \
  --from-literal=root-token="$(openssl rand -hex 16)"

# then uncomment `- 20-vault.yaml` in deploy/k8s/kustomization.yaml and re-apply
kubectl apply -k deploy/k8s
```

> Note: the bundled **k8s** Vault manifest still runs in dev mode — the encrypted
> file storage + auto-unseal setup currently ships in the Docker Compose stack.
> For k8s production, point the control-plane at your own sealed Vault.

Point the UI at **external** Prometheus/Loki/Vault by editing the
`web-ui-config` ConfigMap in `10-web-ui.yaml` (or drop the bundled Deployments
and set the URLs to your existing services). The control-plane manifest
(`50-control-plane.yaml`) is included but left out of `kustomization.yaml` until
its image exists (Phase 2).

---

## Notes

- **Vault** in the bundled Docker stack uses encrypted file storage + auto-unseal
  (secrets persist across restarts). For production, use a real sealed Vault with
  KMS/HSM auto-unseal and least-privilege policies — see [SECURITY.md](../SECURITY.md).
- The UI is fully self-contained — React, fonts, and all assets are bundled at
  build time, so the running container makes **zero external network calls**.

## Production hardening

The compose/k8s manifests are reference deployments for self-hosting. Before
production use, also: **pin image tags** (the bundled/demo images use `:latest`
for convenience — pin them and the `rudder-web-ui` image to immutable digests
for reproducibility/SBOM), run Vault with a real unseal flow + persistent
storage, set resource limits to taste, and terminate TLS at the ingress.
