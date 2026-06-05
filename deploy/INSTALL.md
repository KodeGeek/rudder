# Installing Rudder

Rudder ships two ways: **docker-compose** (single host) and a **Helm chart**
(any Kubernetes — kind/minikube, AKS, EKS, GKE, OpenShift). Images are published
multi-arch (amd64/arm64) to GHCR, so you never have to build locally.

> **Set an API key.** Without `RUDDER_API_KEY` the API is unauthenticated
> (fine for localhost). For anything network-reachable, set one — and for SSO,
> front Rudder with an authenticating reverse proxy (e.g. oauth2-proxy / OIDC).

---

## Docker Compose (single host)

```bash
git clone https://github.com/KodeGeek/rudder && cd rudder
cp .env.example .env            # set VAULT_DEV_TOKEN, DATA_SOURCE=live, RUDDER_API_KEY=...
docker compose --profile bundled --profile backend up -d
# UI → http://localhost:8080
```

---

## Kubernetes (Helm)

The chart lives at `deploy/helm/rudder`. Common flags:

| Value | Default | Purpose |
|---|---|---|
| `persistence.storageClassName` | `""` (cluster default) | set per cloud (see below) |
| `webUi.service.type` | `NodePort` | `ClusterIP` / `LoadBalancer` |
| `webUi.ingress.enabled` | `false` | enable + set `host`/`className`/`tls` |
| `controlPlane.apiKey.value` | `""` | shared API key (or use `existingSecret`) |
| `controlPlane.hostStats.enabled` | `false` | host CPU/mem/disk (single-node only) |
| `image.registry` / `*.image.tag` | `ghcr.io/kodegeek` / chart appVersion | pin images |

Generate a key once and reuse it:

```bash
export RUDDER_KEY=$(openssl rand -hex 24)
```

### kind / minikube / docker-desktop

```bash
helm install rudder deploy/helm/rudder -n rudder --create-namespace \
  --set controlPlane.apiKey.value=$RUDDER_KEY \
  --set controlPlane.hostStats.enabled=true        # single-node: host stats OK
# UI → http://<node-ip>:30080   (minikube: `minikube service web-ui -n rudder --url`)
```

### Azure (AKS)

```bash
helm install rudder deploy/helm/rudder -n rudder --create-namespace \
  -f deploy/helm/rudder/ci/values-aks.yaml \
  --set controlPlane.apiKey.value=$RUDDER_KEY
kubectl -n rudder get svc web-ui -w     # wait for the LoadBalancer EXTERNAL-IP
```

### AWS (EKS)

```bash
helm install rudder deploy/helm/rudder -n rudder --create-namespace \
  -f deploy/helm/rudder/ci/values-eks.yaml \
  --set controlPlane.apiKey.value=$RUDDER_KEY
# needs the EBS CSI driver (gp3). UI → the LoadBalancer hostname on svc/web-ui.
```

### Google (GKE)

```bash
helm install rudder deploy/helm/rudder -n rudder --create-namespace \
  -f deploy/helm/rudder/ci/values-gke.yaml \
  --set controlPlane.apiKey.value=$RUDDER_KEY
```

### OpenShift

```bash
helm install rudder deploy/helm/rudder -n rudder --create-namespace \
  -f deploy/helm/rudder/ci/values-openshift.yaml \
  --set controlPlane.apiKey.value=$RUDDER_KEY
oc expose service/web-ui                 # then: oc get route web-ui
```

### Expose via Ingress (any cloud)

```bash
helm install rudder deploy/helm/rudder -n rudder --create-namespace \
  --set controlPlane.apiKey.value=$RUDDER_KEY \
  --set webUi.service.type=ClusterIP \
  --set webUi.ingress.enabled=true \
  --set webUi.ingress.className=nginx \
  --set webUi.ingress.host=rudder.example.com
```

---

## Verify the install

```bash
kubectl -n rudder rollout status deploy/control-plane
helm test rudder -n rudder          # smoke-checks every component's health endpoint
```

`helm test` runs a pod that curls web-ui, control-plane `/healthz`, prometheus
`/-/healthy`, and vault `/sys/health` in-cluster — green means the stack is wired.

## Upgrade / uninstall

```bash
helm upgrade rudder deploy/helm/rudder -n rudder --reuse-values \
  --set controlPlane.image.tag=v0.2.0
helm uninstall rudder -n rudder      # PVCs (repos/run history, Vault data) are retained
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| PVCs stuck `Pending` | No default StorageClass — set `persistence.storageClassName`. |
| UI loads, "control-plane unreachable" | `kubectl -n rudder logs deploy/control-plane`; check Vault is unsealed. |
| UI prompts for an API key unexpectedly | The server has `RUDDER_API_KEY` set — paste the same value. |
| `helm test` vault check fails early | Vault may still be initializing/unsealing; re-run after `rollout status`. |
| Host-stats card empty on a cloud cluster | Expected — `hostStats.enabled=false` on multi-node. |
