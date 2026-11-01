# Progress

## Current state

- Updated: 2026-11-02. Harness baseline: `fe8f580`; local integration into `main` was requested by the owner. See Git history for the integration commit.
- Product: Kindle Sync, one owner's self-hosted reading dashboard and KOReader plugin.
- The server/authentication foundation has implemented migration/bootstrap/start commands. Sync ingestion, reports, the production plugin and panel are pending; the complete reading service is not ready.
- H01, C0 shared contracts (`07b0c23`) and B1 portable server/authentication (`129645c`) passed their unit gates and review. B2 ingestion/archive/uploads is active. Further P0 owner-run observations are deferred until the assembled application is ready. Machine-readable states and verification evidence are in [feature_list.json](feature_list.json).
- Tests: run `make check` for the current result and coverage; the command records H01/C0 evidence only after all checks succeed.
- Latest combined gate:22 Python,29 contract and37 server unit tests passed. Python combined statement/branch coverage:98.10%; contract JavaScript:100%lines,98.14%branches,100%functions; server/entry JavaScript:97.07%lines,91.89%branches,92.77%functions. These do not measure SQL, real PostgreSQL or device/deployment behavior.

## Done

- Requirements, data contract, configuration policy and approved implementation plan are present.
- A local synthetic EPUB/PDF diagnostic exists under `tests/plugin/prototype/`; its presence does not prove device compatibility.
- H01: repository instructions, feature registry, progress and `make check` are implemented. coverage.py is installed only in the project environment on P:.
- Independent read-only review without chat history answered all five cold-start questions and found no critical/important issues. The whitespace check's limited scope is documented in `docs/harness.md`.
- AGENTS.md follows the template's six sections in English. Detailed workflow/environment instructions are in `docs/development.md`; specifications, testing guidance and plans stay under `docs/` with explicit reading triggers.
- `docs/session-handoff.md` carries agent-transfer context. Its mandatory 70-line limit includes headings and blank lines and is enforced by `make check`.
- The English-only rule explicitly covers repository instructions, documentation and plans. Existing Russian research notes and the application plan are translated without changing their historical claims, technical literals or task states.
- C0: versioned JSON schemas, pure Ajv validators, synthetic fixtures and API v1 cover sync/acks/events, reset generations, uploads and owner routes. Review found five Important issues; all were fixed and the scoped re-review found no new issues. C0 was registered only after review; the verifier recorded passing evidence.
- The fixed C0 unit command participates in the combined gate; failures leave the registry unchanged. Cache/temp settings for child processes stay in the project on P:.
- B1 verifier dispatch was kept disabled until review. Harness tests went RED then GREEN for the server gate, unknown-command rejection and all-or-nothing evidence after contract success/server failure.
- B1 is now reviewed and registered: validated configuration/policy, PostgreSQL schema/migrations, owner/device authentication, private bootstrap, standalone/provider entry points and container examples. Review fixes cover initialization recovery, safe token rotation, throttle Retry-After and expired-failure cleanup. The verifier recorded passing only after the combined gate succeeded.

## Blocked

- P0: remaining owner-run KOReader observations and compatibility decisions are pending final device acceptance. Device copies and actions are performed by the owner; this no longer blocks C0/application implementation.
- C0 and dependent implementation must preserve explicit unverified adapter assumptions; wire validation does not establish hardware compatibility.
- Actual PostgreSQL syntax/concurrency, direct CLI process/terminal behavior, Node24, container/provider deployment remain unverified. Earlier worker runs saw two native Node child-process failures in the unchanged contract suite; subsequent sequential suites and the combined gate passed. The root cause is unknown and no automatic retry masks gate failures.

## Decisions

- The application plan was approved on 2026-11-02; deployment/publication still require separate instruction.
- The owner requested unit tests only, with about 90% coverage. The harness enforces >=90% statement/branch coverage; this overrides older automated E2E/integration test steps in the application plan.
- coverage.py 7.16.2 is approved only for this project's `.local/harness-venv` on P:. Cache and temporary setup files also stay under `.local` on P:.
- Coverage scopes are Python under `scripts/`, executable contracts, and implemented server/entry JavaScript. Lua, SQL and the older standalone diagnostic are not measured by these gates.
- Product constraints remain in AGENTS.md and linked specifications: portable Express/PostgreSQL, private settings, stable source identities and no device writes by agents.
- The owner requested development before further manual Kindle checks. The application plan now applies that order and the newer unit-only testing policy. Keep one active feature at a time; role implementers contribute within that boundary.
- For C0 the owner approved npm registry downloads of ajv 8.17.1, ajv-formats 3.0.1 and their dependencies only, under P:/Code/hackindle/node_modules; cache/temp stays under .local/. No other dependency/runtime/browser download is authorized.

## Next steps

1. Proceed to B2 idempotent ingestion, durable uploads, annotation archive/content and reset barriers under the one-active-feature rule. Existing approved dependencies suffice; no additional download is authorized.
2. Extend the unit verifier to B2 only after its delivery/review; keep SQL persistence and device evidence distinct from unit coverage.
3. Defer the consolidated owner-run Kindle checklist to I1. Keep publication/deployment separate.

At each handoff update this file with verified results, blockers and the next concrete action. `passing` is written only by a verifier with an implemented gate; later sync/plugin/panel features have not passed yet.
