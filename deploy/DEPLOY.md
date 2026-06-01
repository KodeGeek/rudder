# Deploying Rudder

Rudder is shipped as a **segmented stack** — each component is its own
container so a failure in one never takes down the rest. The web-ui is a
static, **read-only** observability app; all configuration lives in Git.

```
        ┌── web-ui ──┐   read-only UI + same-origin proxy (no CORS)
        │            │
        ├─ proxies → ├─ /api/prometheus → Prometheus   (metrics §5.2)
        │            ├─ /api/loki        → Loki         (run logs §5.3)
        │            ├─ /api/vault       → Vault/OpenBao (SSH keys + secrets)
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

Nothing secret-shaped is committed to this repo.

- `.env` is git-ignored — copy `.env.example` → `.env` and fill in values.
- The bundled Vault dev token has **no committed default**. Optionally pin one in
  `.env` (otherwise OpenBao generates a dev root token at start, printed in its
  logs):
  ```bash
  echo "VAULT_DEV_TOKEN=$(openssl rand -hex 16)" >> .env
  ```
- On Kubernetes the Vault token is read from a Secret you create out-of-band (see
  below) — it is never stored in a manifest.

In production, run a real Vault/OpenBao with a proper unseal flow, persistent
storage, and least-privilege policies. Secret *values* are written to Vault
out-of-band; Rudder only references and rotates them — they are never returned
to the browser.

---

## Docker

```bash
cp .env.example .env             # set DATA_SOURCE + endpoints (+ VAULT_DEV_TOKEN for bundled)

# just the UI (demo data, or external endpoints via .env)
docker compose up --build        # → http://localhost:8080

# UI + bundled vault / prometheus / pushgateway / loki
docker compose --profile bundled up --build

# add the control-plane (Phase 2) and/or grafana
docker compose --profile bundled --profile backend up --build
docker compose --profile bundled --profile grafana up --build
```

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

Point the UI at **external** Prometheus/Loki/Vault by editing the
`web-ui-config` ConfigMap in `10-web-ui.yaml` (or drop the bundled Deployments
and set the URLs to your existing services). The control-plane manifest
(`50-control-plane.yaml`) is included but left out of `kustomization.yaml` until
its image exists (Phase 2).

---

## Notes

- **Vault** runs in dev mode in the bundled stack (demo only). In production use
  a real unseal flow, persistent storage, and least-privilege policies.
- The UI is fully self-contained — React, fonts, and all assets are bundled at
  build time, so the running container makes **zero external network calls**.
