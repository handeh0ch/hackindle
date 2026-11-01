# Progress

## Current state

- Updated: 2026-11-02. Harness baseline: `fe8f580`; local integration into `main` was requested by the owner. See Git history for the integration commit.
- Product: Kindle Sync, one owner's self-hosted reading dashboard and KOReader plugin.
- Application server, production plugin and panel are not implemented. There is no application start command yet.
- H01 harness is implemented. C0 shared contracts are the active task; further P0 owner-run observations are deferred until the assembled application is ready. Machine-readable states and verification evidence are in [feature_list.json](feature_list.json).
- Tests: run `make check` for the current result and coverage; the command records H01 evidence only after success.
- Latest local harness result: 18 unit tests passed; combined statement/branch coverage of harness source is 97.85%. C0 dispatch tests went RED then GREEN; they cover success, failure without registry promotion, null verification and rejection of unknown commands. Handoff boundary tests accept 70 lines and reject 71 lines or a missing file.

## Done

- Requirements, data contract, configuration policy and approved implementation plan are present.
- A local synthetic EPUB/PDF diagnostic exists under `tests/plugin/prototype/`; its presence does not prove device compatibility.
- H01: repository instructions, feature registry, progress and `make check` are implemented. coverage.py is installed only in the project environment on P:.
- Independent read-only review without chat history answered all five cold-start questions and found no critical/important issues. The whitespace check's limited scope is documented in `docs/harness.md`.
- AGENTS.md follows the template's six sections in English. Detailed workflow/environment instructions are in `docs/development.md`; specifications, testing guidance and plans stay under `docs/` with explicit reading triggers.
- `docs/session-handoff.md` carries agent-transfer context. Its mandatory 70-line limit includes headings and blank lines and is enforced by `make check`.
- The English-only rule explicitly covers repository instructions, documentation and plans. Existing Russian research notes and the application plan are translated without changing their historical claims, technical literals or task states.
- The harness can dispatch the fixed C0 unit command and records evidence only after all checks pass. C0 verification stays null while the contract delivery is incomplete or unreviewed; no application feature has been promoted.

## Blocked

- P0: remaining owner-run KOReader observations and compatibility decisions are pending final device acceptance. Device copies and actions are performed by the owner; this no longer blocks C0/application implementation.
- C0 and dependent implementation must preserve explicit unverified adapter assumptions; wire validation does not establish hardware compatibility.

## Decisions

- The application plan was approved on 2026-11-02; deployment/publication still require separate instruction.
- The owner requested unit tests only, with about 90% coverage. The harness enforces >=90% statement/branch coverage; this overrides older automated E2E/integration test steps in the application plan.
- coverage.py 7.16.2 is approved only for this project's `.local/harness-venv` on P:. Cache and temporary setup files also stay under `.local` on P:.
- The first coverage scope is `scripts/`, the implemented harness source. Production application/Lua code and the older standalone diagnostic are not measured by this gate.
- Product constraints remain in AGENTS.md and linked specifications: portable Express/PostgreSQL, private settings, stable source identities and no device writes by agents.
- The owner requested development before further manual Kindle checks. The application plan now applies that order and the newer unit-only testing policy. Keep one active feature at a time; role implementers contribute within that boundary.
- For C0 the owner approved npm registry downloads of ajv 8.17.1, ajv-formats 3.0.1 and their dependencies only, under P:/Code/hackindle/node_modules; cache/temp stays under .local/. No other dependency/runtime/browser download is authorized.

## Next steps

1. Implement/review C0 versioned schemas, synthetic fixtures and pure validators. The backend role is contributing only this shared feature; it is not starting B1.
2. Add the executable contract unit/coverage gate to the harness, then review before recording C0 completion. JSON schema tests and executable-code coverage have different measurement boundaries.
3. After C0, proceed to B1 under the one-active-feature rule. Defer the consolidated owner-run Kindle checklist to I1.

At each handoff update this file with verified results, blockers and the next concrete action. `passing` is written only by a verifier with an implemented gate; no application feature currently has one.
