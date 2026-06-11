# web-ui — Core

React 18 + TS strict + Vite.

- src/screens/ — Overview, Jobs, JobDetail, Manifest, Activity, Inventory, Settings (Connect/Credentials sub-screens), Login
- src/lib/api.ts — typed REST client → `/api/control-plane/*` (nginx proxies server-side; the browser never talks to backends directly)
- src/lib/data.tsx — React context + polling, consumed via `useData()`
- src/lib/config.ts — runtime endpoints read from public/config.js, regenerated at container start from env vars (endpoint changes need no rebuild)
- src/components/ — ui.tsx (base primitives), composite.tsx (complex), icons.tsx · src/data/types.ts — Job/Run/Repo/Host/Channel contracts

Invariants:
- Zero external network calls at runtime; all assets bundled in the image.
- Must degrade gracefully (stale/no-data states) when control-plane/Prometheus/Loki are unreachable — never hard-fail.
- DATA_SOURCE=mock|live switches mock data vs real API.