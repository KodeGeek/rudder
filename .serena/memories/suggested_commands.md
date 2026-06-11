# Commands

Full stack (repo root):
- `cp .env.example .env` (set DATA_SOURCE=live for real backend)
- `docker compose --profile bundled --profile backend up --build` → UI at http://localhost:8080

control-plane (cd control-plane):
- `pip install -r requirements-dev.txt`
- `pytest` — full backend suite
- `uvicorn app.main:app --reload --port 8090` — local dev server

web-ui (cd web-ui):
- `npm run dev` — vite hot reload on :5173
- `npm run build` — tsc --noEmit && vite build → dist/
- `npm run typecheck` — tsc --noEmit only
- `npm run preview` — serve built bundle on :8080

Git: branches `feat/<short>` | `fix/<short>` | `docs/<short>`; Conventional Commits.
Darwin: standard BSD userland, no project-specific command deviations.