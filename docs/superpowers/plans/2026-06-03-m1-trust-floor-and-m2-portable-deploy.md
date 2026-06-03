# M1 Trust Floor + M2 Portable Deploy — Implementation Plan

> **For agentic workers:** execute task-by-task. Steps use `- [ ]`. Each task is
> self-contained, ends green (tests/compile/lint pass), and gets its own commit.

**Goal:** Make Rudder safe to expose and safe against data loss (M1), then
trivially deployable to any environment via a published Helm chart + public
images (M2).

**Architecture:** Keep `store.py`'s public API stable but back it with SQLite
(WAL) so run logs append as rows instead of rewriting a whole file. Add a thin
auth dependency guarding all FastAPI routes (shared key, localhost fallback, role
seam). Bound run concurrency with a worker pool. Package the existing kustomize
manifests as a values-driven Helm chart with published multi-arch images.

**Tech stack:** Python 3.12 / FastAPI / APScheduler / sqlite3 (stdlib) / pytest;
React + Vite + TS; Helm 3; GitHub Actions + buildx + GHCR; kustomize (retained).

**Decisions locked with the user:** M1 then M2; auth = shared API key + reverse-
proxy SSO; datastore = SQLite now. **Constraints:** no secrets in git; segmented
containers; offline/community-friendly; UI must tolerate any backend being down.

**Conventions:** tests in `control-plane/tests/`, run with `pytest` from
`control-plane/`. Don't break the existing `store` public surface
(`jobs`, `runs`, `repos`, `add_run`, `replace_run`, `append_run_log`,
`job_view`, `activity_view`, `load_*`). Verify each backend slice with
`python3 -m py_compile` + `pytest`; UI with `npx tsc --noEmit`.

---

## M1 — Trust Floor

### Task 1 — SQLite data layer (fixes the run-log write storm)
**Files:** Create `control-plane/app/db.py`, `control-plane/tests/test_store_sqlite.py`;
Modify `control-plane/app/store.py` (load/save/append paths), `config.py` (add `DB_FILE`), `requirements.txt` (none — stdlib sqlite3), `Dockerfile` (ensure tests dir excluded from runtime image is fine).

- [ ] Write `db.py`: a small connection helper opening `config.DB_FILE` with
  `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`; a
  `migrate()` creating tables: `repos(id TEXT PK, json TEXT)`,
  `runs(id TEXT PK, job TEXT, at INTEGER, status TEXT, duration INTEGER, exit INTEGER, host TEXT, streaming INTEGER, json TEXT)`,
  `run_logs(run_id TEXT, seq INTEGER, t TEXT, text TEXT, PRIMARY KEY(run_id,seq))`,
  with indexes on `runs(job, at DESC)` and `run_logs(run_id, seq)`.
- [ ] One-time JSON import: on `migrate()`, if `repos`/`runs` tables are empty and
  `STATE_FILE`/`RUNS_FILE` exist, import them (runs' `log` arrays become
  `run_logs` rows), then rename the JSON files to `*.imported`.
- [ ] Rework `store.py`: keep the in-memory dicts as a read cache, but make
  `add_run` insert a row + log rows, `replace_run` update the row, and
  `append_run_log` **insert a single `run_logs` row** (the storm fix — no whole
  blob rewrite). `save_repos` upserts the repo row. Keep run history capped at 50
  per job via a delete of older rows.
- [ ] `job_view`/`activity_view` read logs from `run_logs` (ordered by seq) for the
  selected run; keep the response shape identical so the UI is unchanged.
- [ ] Tests: round-trip a repo; add a run + 200 log lines and assert only N row
  inserts (not whole-file rewrites) and correct ordering; assert 50-run cap; assert
  JSON import path produces the same `job_view` output; assert WAL file created.
- [ ] `py_compile` + `pytest` green. Commit.

### Task 2 — Bounded run queue + backpressure
**Files:** Modify `control-plane/app/runner.py` (replace `run_async`), `config.py` (`RUN_WORKERS`, `RUN_QUEUE_MAX`), `main.py` (`/jobs/{name}/run` returns 429 on saturation); Create `control-plane/tests/test_runner_queue.py`.

- [ ] Add a module-level `ThreadPoolExecutor(max_workers=RUN_WORKERS)` + a bounded
  pending counter. `run_async` submits to the pool; if pending+active ≥
  `RUN_QUEUE_MAX`, it raises `QueueFull`.
- [ ] `run_now` in `main.py` catches `QueueFull` → `HTTPException(429, "run queue full")`.
- [ ] Preserve current behavior: per-job single-flight (don't enqueue a second run
  for a job already running) — return 409 in that case.
- [ ] Tests: saturate the queue → 429; duplicate job → 409; normal submit runs.
  Use a fake job target to avoid real ansible.
- [ ] `py_compile` + `pytest` green. Commit.

### Task 3 — SSH host-key trust hardening
**Files:** Modify `control-plane/app/runner.py` (env + known_hosts), `config.py` (`SSH_KNOWN_HOSTS`, `SSH_STRICT`); Create `control-plane/tests/test_runner_ssh.py`.

- [ ] Replace `UserKnownHostsFile=/dev/null` + `StrictHostKeyChecking=no` with a
  persisted known_hosts at `config.SSH_KNOWN_HOSTS` (on the cp-work volume) and
  `StrictHostKeyChecking=accept-new` (trust-on-first-use) by default; `SSH_STRICT=1`
  switches to `yes`. Keep `ConnectTimeout`.
- [ ] Tests: assert the built `ANSIBLE_SSH_ARGS` contains `accept-new` + the
  known_hosts path by default, and `=yes` when `SSH_STRICT` set.
- [ ] `py_compile` + `pytest` green. Commit.

### Task 4 — API authentication (backend)
**Files:** Create `control-plane/app/auth.py`, `control-plane/tests/test_auth.py`;
Modify `main.py` (apply dependency globally, leave `/healthz`/`/readyz` open), `config.py` (`API_KEY`, `AUTH_DISABLED`).

- [ ] `auth.py`: `require_auth` dependency. If `config.API_KEY` is set, require
  `Authorization: Bearer <key>` (constant-time compare) → 401 otherwise. If unset,
  allow (localhost/community fallback) but log a one-time warning. Add a `Role`
  enum + `principal` stub (admin) so M4 can extend without touching every route.
- [ ] Apply as `app = FastAPI(dependencies=[Depends(require_auth)])`; explicitly
  exclude `/healthz` and a new `/readyz` (probe endpoints must stay open).
- [ ] Add `GET /auth/verify` returning `{ok, role}` for the UI to test a key.
- [ ] Tests: no key configured → open; key configured + correct header → 200; wrong/
  missing header → 401; `/healthz` always open.
- [ ] `py_compile` + `pytest` green. Commit.

### Task 5 — Web-UI auth (login + 401-vs-offline)
**Files:** Create `web-ui/src/screens/Login.tsx`; Modify `web-ui/src/lib/api.ts` (inject `Authorization`, throw a typed `AuthError` on 401), `web-ui/src/lib/data.tsx` (distinguish 401 from offline), `web-ui/src/App.tsx` (gate on auth).

- [ ] `api.ts`: read token from `localStorage('rudder_token')`, add
  `Authorization: Bearer` to `get`/`send`. On `401`, throw `AuthError` (not a
  generic error) so callers can tell unauthorized from down.
- [ ] `data.tsx`: the `Promise.allSettled` resilience loop must treat `AuthError`
  as "needs login" (set an `unauthorized` flag) rather than "backend down".
- [ ] `Login.tsx`: a "Provide API key" screen; on submit, call `api.verify()`; on
  success store token + reload; on failure show error. App renders `Login` when no
  token or `unauthorized`.
- [ ] `npx tsc --noEmit` green; manual smoke later via deploy. Commit.

### Task 6 — Dependency pinning + CI + secret scan + tests
**Files:** Modify `control-plane/requirements.txt` (pin ==), `deploy/k8s/*.yaml` + `docker-compose.yml` (pin external image tags); Create `.github/workflows/ci.yml`, `control-plane/pytest.ini`, `control-plane/requirements-dev.txt`.

- [ ] Pin every Python dep to an exact version; pin external images (openbao,
  prom/prometheus, grafana/loki, prom/pushgateway, nginx) to specific tags.
- [ ] `ci.yml`: jobs — (a) backend: install deps, `py_compile`, `pytest`; (b)
  frontend: `npm ci`, `tsc --noEmit`, `vite build`; (c) images: `docker build` both
  (no push); (d) secret scan: Trivy fs / `gitleaks` over the repo, fail on findings.
- [ ] `pytest.ini` pointing at `tests/`.
- [ ] CI is green on a dry run (`act` optional) or by inspection; commit.

---

## M2 — Portable Deploy

### Task 7 — Helm chart
**Files:** Create `deploy/helm/rudder/` (`Chart.yaml`, `values.yaml`, `templates/*` mirroring the 6 kustomize files + `_helpers.tpl`, `NOTES.txt`).

- [ ] Template the existing `deploy/k8s/*.yaml`. Parameterize per component:
  `image.registry/repository/tag`, `imagePullPolicy`, `replicaCount`,
  `resources`, `persistence.storageClassName` (default `null` → cluster default,
  **not** `local-path`), `service.type` (ClusterIP/NodePort/LoadBalancer),
  `ingress.{enabled,className,host,tls}`, `hostStats.enabled` (default `false`).
- [ ] `helm lint` clean; `helm template` renders for default + an Ingress values
  set + a LoadBalancer values set. Commit.

### Task 8 — Multi-arch image publish to GHCR
**Files:** Create `.github/workflows/release.yml`.

- [ ] On tag `v*`: `docker/setup-buildx`, login to `ghcr.io`, build+push
  `web-ui`, `control-plane`, `target` for `linux/amd64,linux/arm64`, tag with the
  release version + `latest`, emit digests. Update chart `values.yaml` defaults to
  the published `ghcr.io/<owner>/rudder-*` repository.
- [ ] Workflow validates by inspection (YAML lint). Commit.

### Task 9 — Cloud overlays + helm test + INSTALL.md
**Files:** Create `deploy/helm/rudder/ci/values-{aks,eks,gke,openshift}.yaml`, `deploy/helm/rudder/templates/tests/smoke.yaml`, `deploy/INSTALL.md`.

- [ ] Cloud overlays set the right `storageClassName` (azurefile-csi/managed-csi,
  gp3, premium-rwo/standard-rwo), `service.type`, and (openshift) drop hostPath +
  set SCC-friendly securityContext. `hostStats.enabled=false` on multi-node.
- [ ] `helm test` smoke pod: curl web-ui `/`, prometheus `/-/healthy`, vault
  `/sys/health`, control-plane `/healthz`.
- [ ] `INSTALL.md`: copy-paste one-liners for docker-compose, kind/minikube, AKS,
  EKS, GKE, OpenShift + verification + troubleshooting.
- [ ] `helm lint`/`template` across overlays clean. Commit.

---

## Self-review notes
- Storm fix is in **Task 1** (per-line row insert), sequenced **before** any
  atomic-whole-file work — matching the critique's ordering correction.
- Backpressure (Task 2) lands **with** auth (Task 4), not deferred, since exposing
  the API makes thread-storm a live risk.
- Role seam added in Task 4 so M4 RBAC doesn't re-open all routes.
- SQLite chosen now (Task 1) so JSON-hardening isn't throwaway.
- Helm keeps kustomize working (Task 7 mirrors, doesn't delete) for existing
  host20 deploy.
