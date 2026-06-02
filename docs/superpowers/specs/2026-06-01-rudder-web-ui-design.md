# Rudder Web-UI — Phase 1 Design

_GitOps Control Plane · 2026-06-01_

## Context

`rudder` is a self-hostable **GitOps server that schedules Ansible jobs**, driven
entirely by a Git repo (GitHub **or** Azure DevOps) as the single source of truth.
A polished UI design was produced in Claude Design and handed off as an
HTML/CSS/JS prototype (React via CDN + in-browser Babel). The design chat shows
the product deliberately landed on a **read-only** posture: Git is the source of
truth; the UI **views** status/history/logs and triggers **explicit** runs — it
never writes to Git.

This spec covers **Phase 1 only**: recreating the UI as a real, production-grade,
containerized app + the deployment scaffolding. The control-plane backend that
makes the GitHub/Azure DevOps/Vault integrations actually *work* is **Phase 2**
(its own spec).

## Goals

- Recreate the Rudder design **pixel-for-pixel** as a real app.
- **Fully containerized & segmented**: every component is its own container,
  independently updatable, with its own healthcheck/restart policy. The web-UI
  has **no hard dependency** on any backend — it stays up and shows
  "stale / no data" states when backends are down (nginx resolves upstreams
  lazily at request time).
- **Offline-capable / air-gapped**: no runtime CDN calls (React + fonts vendored,
  JSX precompiled at build).
- **Zero secrets in git.**
- Runs on Docker and Kubernetes; validated on both locally.

## Non-goals (Phase 2)

- The control-plane backend: Git clone/pull (GitHub + ADO), manifest→cron
  rendering, Ansible runner, Vault secret/SSH-key fetch, metrics/log push, and
  the API the UI binds to in "live" mode. Stays a documented placeholder
  (compose `backend` profile + commented k8s) exactly as in the handoff bundle.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Scope this pass | Web-UI + deploy scaffolding only | Decompose; backend is a separate subsystem |
| UI stack | **Vite + React 18 + TypeScript** | Production-grade; types document the §5 data contracts for Phase 2 |
| Fonts | Vendored via `@fontsource/geist` (sans+mono) | Air-gapped; no Google Fonts CDN |
| Styling | Keep `tokens.css` + port inline styles **verbatim** | Pixel fidelity; no Tailwind/CSS-module rewrite (drift risk) |
| Runtime config | `public/config.js` → `window.RUDDER_CONFIG`, regenerated from env at container start | Point at external endpoints without rebuilding |
| Routing | Hand-rolled state routing (as prototype) | No extra dep; URLs not required for v1 |
| Tweaks panel | **Dropped** | Claude-Design `postMessage` edit-mode scaffolding; dead in production |
| Editor leftovers | `DiffViewer`, `CronInput` **dropped** | Unused in the final read-only design |
| Theme toggle | Kept, persisted to `localStorage` | Real user feature; works standalone |
| K8s secrets | Token via uncommitted Secret (created out-of-band) | No secret-shaped value in git |

## Architecture / component mapping

Prototype `window.*` globals + Babel `<script>` tags → ES modules.

| Prototype | New module |
|---|---|
| `window.CAD` mock data | `src/data/mock.ts` (typed; deterministic NOW + seeded PRNG) |
| `window.CAD_CONFIG` | `src/lib/config.ts` reads `window.RUDDER_CONFIG` from `public/config.js` |
| `tokens.css` | `src/styles/tokens.css` (verbatim) |
| `ui.jsx` helpers (relTime, cronHuman, dur…) | `src/lib/format.ts` |
| `ui.jsx` atoms (Btn, StatusDot/Pill, Sparkline, Ring, Card, Logo…) | `src/components/ui.tsx` |
| `icons.jsx` | `src/components/icons.tsx` |
| `components.jsx` (LogViewer, RunTimeline, Toast) | `src/components/composite.tsx` |
| `app.jsx` (shell, routing, run-now sim, theme) | `src/App.tsx` |
| `screen-*.jsx` | `src/screens/{Overview,Jobs,JobDetail,Manifest,Activity,Inventory,Settings,Connect}.tsx` |

## Repo layout (monorepo; anticipates Phase 2 `control-plane/`)

```
rudder/
  README.md  LICENSE  .gitignore  .env.example
  docker-compose.yml            # segmented stack, profiles: bundled / backend / grafana
  deploy/
    DEPLOY.md  prometheus.yml
    k8s/  (00-namespace, 10-web-ui, 20-vault, 30-prometheus, 40-loki, 50-control-plane, kustomization)
  web-ui/
    Dockerfile  .dockerignore   # multi-stage: node build → nginx serve
    nginx/
      default.conf.template
      docker-entrypoint.d/{05-resolver.envsh, 30-rudder-config.sh}
    package.json  tsconfig.json  vite.config.ts  index.html
    public/config.js             # runtime config default (regenerated at container start)
    src/ (as mapped above)
```

## Runtime config (env-overridable without rebuild)

`index.html` loads `/config.js` (plain, non-hashed, no-cache) **before** the
bundle. `config.js` sets `window.RUDDER_CONFIG` with `dataSource` (`mock`|`live`)
and the proxy/health paths for prometheus/loki/control-plane/vault. The container
entrypoint `30-rudder-config.sh` regenerates `config.js` from env at start.
The browser only ever calls **same-origin** `/api/*` paths; nginx reverse-proxies
to the real upstreams (no CORS, endpoints stay server-side).

## Deploy

- **`web-ui/Dockerfile`** — stage 1 `node:lts-alpine` runs `npm ci && npm run build`
  → `dist/`; stage 2 `nginx:1.27-alpine` serves `dist/` + entrypoints + nginx
  template. Healthcheck on `/`.
- **nginx** — ported template: security headers, gzip, SPA fallback, lazy
  `resolver` (auto-detected from `resolv.conf`; works on Docker `127.0.0.11` and
  k8s CoreDNS), `/api/{prometheus,loki,control-plane,vault}` proxies returning 503
  when an upstream is unset.
- **`docker-compose.yml`** — one container per component; profiles
  `bundled` (vault/prometheus/pushgateway/loki), `backend` (control-plane),
  `grafana`. web-UI has **no `depends_on`** (fault isolation by design).
- **`deploy/k8s/`** — per-component Deployment+Service (+ConfigMap/PVC/Ingress),
  probes, `kustomization.yaml`. control-plane commented out until its image exists.

## Secret hygiene (hard constraint: nothing secret in git)

- `.gitignore`: `.env`, `node_modules`, `dist`, build caches.
- `.env.example`: placeholders only.
- Vault dev token: **no value committed.** Compose reads `VAULT_DEV_TOKEN` from
  `.env` and only the `bundled` profile requires it (`${VAULT_DEV_TOKEN:?…}`),
  so `docker compose up` (UI-only) needs nothing. K8s `20-vault.yaml` references a
  Secret the operator creates out-of-band (documented in DEPLOY.md), not a
  committed `stringData` value.

## Testing / verification (definition of done)

1. `npm run build` + `tsc` typecheck pass clean.
2. `docker build` (multi-stage) succeeds; image serves on `:8080`.
3. `docker compose up` (UI-only) serves the app; `--profile bundled` brings up
   vault/prometheus/loki/pushgateway each healthy and independent.
4. **Fault isolation proof**: kill a backend container → UI stays up (degraded
   state), recovers when it returns.
5. Secret scan of the tree: nothing secret-shaped committed; `.env` ignored.
6. Headless render smoke-test: all screens mount, no console errors.
7. K8s: deploy to local **`docker-desktop`** cluster (NOT the enterprise AKS
   contexts), verify pods/services/probes; `kubectl kustomize` validates.

## Phase 2 (out of scope here)

Control-plane backend as its own container(s): GitHub + Azure DevOps providers,
Vault integration (SSH keys + secrets, reference/rotate, never returned to
browser), manifest reconcile loop, Ansible job runner, Pushgateway/Loki emission,
and the `/api/control-plane` API the UI binds to in live mode. Separate spec.
