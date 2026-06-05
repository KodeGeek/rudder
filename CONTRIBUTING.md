# Contributing to Rudder

Thanks for your interest in Rudder! This guide gets you from clone to a running
dev stack and explains how to propose changes.

> **The one hard rule: never commit a secret.** No tokens, SSH keys, vault
> passwords, or `.env` files — ever, in any commit. Secrets live only in Vault at
> runtime. CI runs a secret scan and will fail the build. See [SECURITY.md](SECURITY.md).

## Prerequisites

- **Docker Engine 24+** and the **Compose v2** plugin (`docker compose`, not the
  legacy `docker-compose`)
- **Node.js 22+** and npm (only for UI development)
- **Python 3.12+** (only for control-plane development)
- Git, and ~2 vCPU / 2 GB free RAM for the full bundled stack

## Run the full stack (recommended)

The bundled stack is self-contained — it ships its own Git server, Vault, and an
SSH target, so you can develop against real components with no external services
or secrets:

```bash
cp .env.example .env
echo "DATA_SOURCE=live" >> .env
docker compose --profile bundled --profile backend up --build
# UI → http://localhost:8080
```

See [deploy/DEPLOY.md](deploy/DEPLOY.md) for profiles, Kubernetes, and verifying
the deployment.

## Develop a single component

**Web UI** (Vite + React + TypeScript):

```bash
cd web-ui
npm ci
npm run dev          # hot-reloading dev server
npm run build        # typecheck (tsc --noEmit) + production build → web-ui/dist
```

**Control plane** (Python + FastAPI): the easiest path is to run the rest of the
stack via Compose and iterate on the control-plane container:

```bash
docker compose --profile bundled --profile backend up -d --build control-plane
docker compose logs -f control-plane
```

For pure-Python work without containers:

```bash
cd control-plane
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# point at a running bundled Vault, or expect Vault calls to no-op
uvicorn app.main:app --reload --port 8090
```

## Tests

The control-plane has a `pytest` suite (run queue, auth/RBAC, audit, metrics,
secret rotation, SQLite store, SSH args, playbook view). Run it before opening a PR,
and add tests for new behavior:

```bash
cd control-plane && pip install -r requirements.txt && pytest        # backend suite
cd web-ui && npm run build                                           # type-checks the UI
```

CI runs the same checks plus a secret scan; all must pass before merge.

## Branches, commits, and PRs

- Branch from `main`: `feat/<short-topic>`, `fix/<short-topic>`, or `docs/<short-topic>`.
- Write focused commits with clear messages (we loosely follow
  [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `docs:`, `chore:`).
- Keep PRs small and single-purpose. Fill in the PR template and link any issue.
- **Docs as code:** if your change affects deployment, configuration, or behavior,
  update the README and/or `deploy/DEPLOY.md` in the same PR.
- CI (build + type-check + secret scan) must pass before merge.

## Code style

- **TypeScript/React:** match the existing component and token conventions in
  `web-ui/src`; no new heavy dependencies without discussion.
- **Python:** follow PEP 8 and the patterns already in `control-plane/app`
  (small, focused modules; explicit over clever).
- Match the surrounding code's style, naming, and comment density.

## Reporting bugs / requesting features

Open an issue using the templates. For anything security-sensitive, **do not open
a public issue** — follow [SECURITY.md](SECURITY.md).
