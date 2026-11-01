# Progress

## Current state

- Updated: 2026-11-02. Harness baseline: `fe8f580`; local integration into `main` was requested by the owner. See Git history for the integration commit.
- Product: Kindle Sync, one owner's self-hosted reading dashboard and KOReader plugin.
- Application server, production plugin and panel are not implemented. There is no application start command yet.
- H01 harness is implemented; P0 compatibility observations are the next project task. Machine-readable states and verification evidence are in [feature_list.json](feature_list.json).
- Tests: run `make check` for the current result and coverage; the command records H01 evidence only after success.
- Latest local result: 14 unit tests passed; combined statement/branch coverage of harness source is 97.40%. The first coverage run failed at 88.41%, confirming the threshold blocks completion. Handoff boundary tests accept 70 lines and reject 71 lines or a missing file.

## Done

- Requirements, data contract, configuration policy and approved implementation plan are present.
- A local synthetic EPUB/PDF diagnostic exists under `tests/plugin/prototype/`; its presence does not prove device compatibility.
- H01: repository instructions, feature registry, progress and `make check` are implemented. coverage.py is installed only in the project environment on P:.
- Independent read-only review without chat history answered all five cold-start questions and found no critical/important issues. The whitespace check's limited scope is documented in `docs/harness.md`.
- AGENTS.md follows the template's six sections in English. Detailed workflow/environment instructions are in `docs/development.md`; specifications, testing guidance and plans stay under `docs/` with explicit reading triggers.
- `docs/session-handoff.md` carries agent-transfer context. Its mandatory 70-line limit includes headings and blank lines and is enforced by `make check`.

## Blocked

- P0: owner-run KOReader observations and compatibility decisions are pending. Device copies and actions are performed by the owner.
- C0 and dependent implementation must not assume that unverified P0 adapters work.

## Decisions

- The application plan was approved on 2026-11-02; deployment/publication still require separate instruction.
- The owner requested unit tests only, with about 90% coverage. The harness enforces >=90% statement/branch coverage; this overrides older automated E2E/integration test steps in the application plan.
- coverage.py 7.16.2 is approved only for this project's `.local/harness-venv` on P:. Cache and temporary setup files also stay under `.local` on P:.
- The first coverage scope is `scripts/`, the implemented harness source. Production application/Lua code and the older standalone diagnostic are not measured by this gate.
- Product constraints remain in AGENTS.md and linked specifications: portable Express/PostgreSQL, private settings, stable source identities and no device writes by agents.

## Next steps

1. Prepare/review P0 synthetic diagnostic instructions; wait for owner-run observations, then record compatibility findings.
2. Freeze C0 contracts. Before application implementation, revise the older plan's test commands for the unit-only policy and add measurable coverage gates for each implemented language.

At each handoff update this file with verified results, blockers and the next concrete action. `passing` is written only by a verifier with an implemented gate; no application feature currently has one.
