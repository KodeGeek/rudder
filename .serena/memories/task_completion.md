# Definition of Done

Run before claiming a coding task complete:
1. `cd control-plane && pytest` — backend suite green
2. `cd web-ui && npm run build` — typecheck + prod build clean
3. No secrets introduced (gitleaks runs in CI; .env never committed)
4. If behavior/config/deploy changed → update README.md + deploy/DEPLOY.md in the SAME PR (docs-as-code rule)
5. Conventional Commit message on a feat/|fix/|docs/ branch