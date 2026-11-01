# Project instructions

Read this file before working in the repository.

## Project and commands

- Kindle Sync is a planned self-hosted KOReader archive/dashboard: notes with context, reading history, sessions and calendar. The server, production plugin and panel are not implemented yet.
- Application stack: Node.js/Express, PostgreSQL, HTML/CSS/JavaScript/SVG and Lua/KOReader.
- Current verification: `make check` (unit tests, >=90% statement/branch coverage of harness Python, feature registry and diff checks).
- Without Make: `.local/harness-venv/Scripts/python.exe -B scripts/check.py`. No installation runs during checks.
- Harness setup and coverage boundaries: [docs/harness.md](docs/harness.md). There is no application start command yet.
- At session start read [PROGRESS.md](PROGRESS.md) and [feature_list.json](feature_list.json); update progress before ending a session.

## Completion and testing

- Work on one active feature at a time. Registry states are exactly `not_started`, `active`, `blocked`, `passing`.
- The owner's 2026-11-02 testing policy is unit tests only, with a blocking coverage target >=90%. It supersedes older automated E2E/integration test instructions in the application plan.
- Only an implemented verifier may write `passing` and successful evidence, after its checks pass. Never manually promote a feature or treat a missing verifier as success.
- A null verification command means the gate is not implemented; it cannot establish completion.
- Evidence records the last successful run. Changes after that run require fresh verification.
- Before claiming completion rerun `make check` and the feature's implemented unit verifier. Report untested behavior and measurement boundaries.
- The current gate verifies the harness only; application features need their own unit tests and per-language coverage gates. Owner-run device observations remain open evidence, not automated tests.
- Add each new executable unit gate to the checker before allowing it to promote the corresponding application feature.

## Scope and planning

- State assumptions and surface material tradeoffs before implementation. Ask when a missing decision prevents a correct implementation.
- Use the smallest implementation that meets the requested behavior. Keep changes surgical and match existing style.
- Define verifiable success criteria, run the relevant checks and report limitations honestly.
- Product decisions are recorded in `docs/requirements.md`. For implementation, also read `docs/kindle-sync-data-spec.md`, `docs/configuration.md` and `docs/superpowers/plans/2026-11-01-kindle-sync.md`.
- The user approved the updated implementation plan on 2026-11-02. Application implementation and local verification are authorized; external deployment/publication still require a separate instruction.
- The requested implementation team is three agents using `gpt-6.1-terra` with reasoning `high`: backend, KOReader plugin and web panel.
- Owner machine constraint: do not download programs, runtimes, package dependencies, browser binaries, container images or source/tool distributions without informing the owner and obtaining approval for the concrete download first. Plan approval alone is not approval of unannounced tool downloads.
- Install nothing on drive C. Approved tools, dependency/browser/package caches, build outputs and temporary setup files must use an explicitly agreed location on drive P. Do not change global runtimes, package managers, Docker settings or system services. Existing tools may be inspected/used without installing new ones; ensure commands do not silently bootstrap/download dependencies.
- Browsing official documentation is allowed. Treat repository clones, Docker pulls, npm installation and browser/runtime installation as downloads requiring the rule above. Set private P-drive cache/temp paths before an approved installation; do not rely on default user-profile paths.
- All copying to the Kindle is performed by the owner. Prepare and review local artifacts/instructions only; do not write, install, update or delete files on the device. Previously permitted read-only USB inspection is separate from device writes.

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
