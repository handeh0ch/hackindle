# Project instructions

Read this file before working in the repository.

## Scope and planning

- State assumptions and surface material tradeoffs before implementation. Ask when a missing decision prevents a correct implementation.
- Use the smallest implementation that meets the requested behavior. Keep changes surgical and match existing style.
- Define verifiable success criteria, run the relevant checks and report limitations honestly.
- Product decisions are recorded in `docs/requirements.md`. For implementation, also read `docs/kindle-sync-data-spec.md`, `docs/configuration.md` and `docs/superpowers/plans/2026-11-01-kindle-sync.md`.
- The implementation plan is awaiting user review. Documentation and repository hygiene are authorized; application implementation and deployment require approval of the updated plan.
- The requested implementation team is three agents using `gpt-6.1-terra` with reasoning `high`: backend, KOReader plugin and web panel.

## Public repository and configuration

- Treat this repository and its history as public. Commit variable names and empty/synthetic examples; keep actual instance settings and credentials outside tracked files.
- Store local settings in ignored `.env`/private paths or deployment environment/secret storage. Keep populated env files, tokens, passwords, private keys, connection credentials, reading data and personal books out of commits, fixtures, screenshots, logs and container images.
- Before committing, inspect the staged diff and staged paths for private data. Before publication, scan the complete Git history with a secret scanner in redacted mode. `.gitignore` alone is not a secret check.
- If a secret is found in history, stop publication, rotate it and arrange history cleanup. Do not print the value or silently rewrite history.
- An author's public Git email is intentional metadata when approved by the owner; do not anonymize or rewrite authorship without an explicit request.
- Keep the application portable: standard Node.js/Express and PostgreSQL. Neon and Vercel are deployment choices; platform-specific code belongs in entry-point adapters.
- Read server configuration through one validated config module. Use relative API paths in the panel and user-supplied URL/token settings in the plugin.

## Documentation lookup

For library, framework, SDK, API, CLI or cloud-service setup and usage, fetch current Context7 documentation: resolve the library first, then query the selected ID. Use official primary sources as fallback. Do not use documentation lookup for ordinary business-logic refactoring or review.
