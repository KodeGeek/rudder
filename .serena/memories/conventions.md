# Conventions

- TypeScript: strict true, noFallthroughCasesInSwitch, isolatedModules; noUnusedLocals/noUnusedParameters intentionally off. No linter/formatter configs — match surrounding style exactly.
- Python: PEP8 by convention, small single-concern modules (one file ≈ one concern), explicit over clever. No type-checker enforced.
- Commits: Conventional Commits (feat:, fix:, docs:, chore:). PRs small and single-purpose, template filled, issues linked.
- No new heavy dependencies without prior discussion.
- web-ui components follow existing patterns: src/components/ui.tsx (base primitives), composite.tsx (complex), icons.tsx; data contracts in src/data/types.ts.
- Never weaken the secrets model: credentials are write-only via the API; YAML carries Vault paths only, never secret values.