# AGENTS.md

Read this file before working in the repository.

## Project

Kindle Sync is a planned self-hosted KOReader archive and reading dashboard: notes with page context, reading history, sessions and calendar.
Stack: Node.js/Express, PostgreSQL, HTML/CSS/JavaScript/SVG and Lua/KOReader. Shared contracts, server/authentication and sync ingestion/archive are implemented; reports, the panel and production plugin are pending.

## Commands

- Setup: follow [docs/harness.md](docs/harness.md); obtain approval before downloading dependencies.
- Start: `npm start` with private environment configuration; migrations and owner bootstrap are required first. See [docs/server-setup.md](docs/server-setup.md). The complete service is not implemented yet.
- Unit tests (Windows): `.local/harness-venv/Scripts/python.exe -B -m unittest discover -s tests/unit -p "test_*.py"`.
- Full verification: `make check` — harness and contract unit tests, >=80% coverage gates, registry/handoff validation and diff checks.
- Without Make: `.local/harness-venv/Scripts/python.exe -B scripts/check.py`.

## Hard constraints (MUST)

- Obtain approval for each concrete tool/dependency download. Use agreed P: paths for installs, caches, build outputs and temporary files; install nothing on C: and leave global tools/settings/services unchanged.
- The owner performs all Kindle writes. Agents prepare local artifacts and instructions only.
- Keep actual settings, credentials, personal books and reading data outside public Git, fixtures, assets, logs and images. Follow the configuration/publication policy before committing or publishing.
- Keep the application portable: standard Express/PostgreSQL, platform adapters at entry points, one validated server config module, relative panel API paths and user-supplied plugin URL/token.
- Deployment and publication require separate owner instructions; application plan approval authorizes implementation and local verification only.

## Definition of Done

- A feature is complete only after a fresh green `make check` and its implemented unit verifier; require >=80% coverage for the implemented code being tested.
- Automated testing is unit-only. This overrides older E2E/integration test steps in the application plan.
- Only a verifier may record `passing` and successful evidence after its checks pass. A missing verifier cannot establish completion.
- Current coverage measures harness Python, contract JavaScript and server/entry JavaScript. SQL, real PostgreSQL, provider/device operation and later application features remain unverified. Owner-run hardware observations remain separate evidence.

## Working rules

- At session start, read `PROGRESS.md` and `feature_list.json`; update progress before ending the session.
- Before transferring work between agents, update [docs/session-handoff.md](docs/session-handoff.md). It MUST contain at most 70 lines, including headings and blank lines; the receiving agent reads it after AGENTS.md.
- Work on one active feature at a time and verify it before starting another. Keep unrelated code unchanged.
- State assumptions and material tradeoffs, define verifiable success criteria, and ask when a missing decision prevents correct implementation.
- Make the smallest requested change and match existing style. Follow [docs/development.md](docs/development.md) before implementation or environment changes.
- Repository instructions, documentation and plans MUST be written and maintained in English.

## Where to find details

- [docs/development.md](docs/development.md) — required before implementation, tool setup/downloads or external documentation lookup; workflow, environment restrictions and approved team.
- [docs/requirements.md](docs/requirements.md) — required before product behavior changes.
- [docs/kindle-sync-data-spec.md](docs/kindle-sync-data-spec.md) — required before API, data model, sync or reading-accounting changes.
- [docs/configuration.md](docs/configuration.md) — required before configuration, credentials, Git commits, packaging, deployment or publication.
- [docs/testing.md](docs/testing.md) and [docs/compatibility-report.md](docs/compatibility-report.md) — owner-run acceptance checklist (unit evidence vs device observations) and the empty report template; required before claiming any hardware result.
- [docs/harness.md](docs/harness.md) — required before harness/testing changes; setup, coverage boundaries and feature-state rules.
- [docs/superpowers/plans/2026-11-01-kindle-sync.md](docs/superpowers/plans/2026-11-01-kindle-sync.md) — approved application implementation plan; read before application work, applying the current unit-only testing policy.
- [docs/superpowers/plans/2026-11-02-minimal-harness.md](docs/superpowers/plans/2026-11-02-minimal-harness.md) — harness implementation plan; read when changing the harness design.
- [PROGRESS.md](PROGRESS.md) and [feature_list.json](feature_list.json) — current work, blockers, next action and verification evidence.
