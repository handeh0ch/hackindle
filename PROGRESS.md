# Progress

## Current state

- B3 implementation and independent review completed on 2026-11-03. A fresh `make check` passed: 26 Python, 34 contract and 132 server unit tests; server coverage 97.84% lines / 86.31% branches / 93.29% functions. The verifier registered B3 passing evidence in `feature_list.json`.
- B3 includes reports, source/history/session/cycle/annotation lists, grouping, goals and credential-free backup/restore. Vocabulary uniqueness uses case-insensitive word and language; source is metadata. Reset regression, backup allocation validation, date boundaries, aggregate overflow and bounded projections were covered by unit tests and reviewed.
- Historical full-object-only vocabulary reset fingerprints cannot identify changed metadata or case. Correct client baseline remains necessary for those older barriers. Actual PostgreSQL SQL/concurrency, cross-database restore, Node 24 and device operation remain unverified.
- Next approved order: P1/P2 plugin, F1/F2 panel, I1 owner-run acceptance and I2 release/deployment guidance. No deployment or publication is authorized by B3 completion.

- Coverage policy update (2026-11-03): the owner lowered all blocking coverage thresholds to 80%, including Python combined statement/branch and JavaScript lines/branches/functions. Historical 90% results below remain historical; B3 completion still requires implementation and independent review.
- Fresh verification after the threshold update: `make check` PASSED; 26 Python, 34 contract and 111 server tests passed. Server coverage: 98.11% lines / 86.83% branches / 94.33% functions. B3 remains active with a null verifier and no passing evidence.

- Updated: 2026-11-03. Harness baseline: `fe8f580`; local integration into `main` was requested by the owner. See Git history for the integration commit.
- Product: Kindle Sync, one owner's self-hosted reading dashboard and KOReader plugin.
- The server/authentication foundation, sync ingestion/archive and B3 reporting are implemented. The production plugin and panel are pending; the complete reading service is not ready.
- H01, C0 shared contracts (`07b0c23`), B1 portable server/authentication (`129645c`) and B2 ingestion/archive/uploads (`45e6f21`) passed their unit gates and review. B3 reports/grouping/backup has passed its unit verifier and independent review. Further P0 owner-run observations are deferred until the assembled application is ready. Machine-readable states and verifier-written evidence are in [feature_list.json](feature_list.json).
- B2 continuation used the requested gpt-6.1-terra/high implementer and independent reviewer. Four Important findings were fixed across two scoped review rounds; all are addressed, with no new actionable breakage. See Git history for the B2 commit after baseline `5cd6d18`.
- Tests: run `make check` for the current result and coverage; the command records enabled feature evidence only after all checks succeed.
- Latest combined gate:24 Python,33 contract and74 server unit tests passed. Python combined statement/branch coverage:98.10%; contract JavaScript:100%lines,98.26%branches,100%functions; server/entry JavaScript:98.11%lines,91.06%branches,94.59%functions. These do not measure SQL, real PostgreSQL or device/deployment behavior.
- The preceding result was the last successful B2 gate. The 2026-11-03 B3 checkpoint `make check` FAILED: server branch coverage 86.83% is below 90% (lines 98.11%, functions 94.33%). All 26 Python, 34 contract and 111 server unit tests passed; Python combined coverage was 98.10%, contracts 100% lines / 98.26% branches / 100% functions. B3 remains active with no verifier/evidence and has not had full independent review.
- The owner requested committing all current changes as an unfinished checkpoint and transferring context through docs/session-handoff.md. The gpt-6.1-terra/high B3 implementer stopped at its usage limit; no paid upgrade or different model was selected.

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
- B2 is reviewed and registered: transactional packet/event deduplication, independent snapshots, global source-owned annotations, archive/reactivation, durable uploads, private covers/content and reset barriers. Review fixes preserve ready context, retain monotonic content versions across reset, compare arbitrary fractional timestamps precisely and bound detail metadata while preserving complete paged context. The shared B1/B2 server gate runs once.

## Blocked

- P0: remaining owner-run KOReader observations and compatibility decisions are pending final device acceptance. Device copies and actions are performed by the owner; this no longer blocks C0/application implementation.
- C0 and dependent implementation must preserve explicit unverified adapter assumptions; wire validation does not establish hardware compatibility.
- Actual PostgreSQL syntax/concurrency, direct CLI process/terminal behavior, Node24, container/provider deployment remain unverified. Earlier worker runs saw two native Node child-process failures in the unchanged contract suite; subsequent sequential suites and the combined gate passed. The root cause is unknown and no automatic retry masks gate failures.

## Decisions

- The application plan was approved on 2026-11-02; deployment/publication still require separate instruction.
- The owner requested unit tests only, with about 90% coverage. On 2026-11-03 the owner lowered the requirement to >=80% for all coverage gates; this overrides older automated E2E/integration test steps in the application plan.
- coverage.py 7.16.2 is approved only for this project's `.local/harness-venv` on P:. Cache and temporary setup files also stay under `.local` on P:.
- Coverage scopes are Python under `scripts/`, executable contracts, and implemented server/entry JavaScript. Lua, SQL and the older standalone diagnostic are not measured by these gates.
- Product constraints remain in AGENTS.md and linked specifications: portable Express/PostgreSQL, private settings, stable source identities and no device writes by agents.
- The owner requested development before further manual Kindle checks. The application plan now applies that order and the newer unit-only testing policy. Keep one active feature at a time; role implementers contribute within that boundary.
- For C0 the owner approved npm registry downloads of ajv 8.17.1, ajv-formats 3.0.1 and their dependencies only, under P:/Code/hackindle/node_modules; cache/temp stays under .local/. No other dependency/runtime/browser download is authorized.
- The owner subsequently approved Express 5.3.0/pg 8.23.1 and their locked dependencies in the same P: node_modules, and Lupa 2.8 plus LuaCov 0.17.0 only under .local/. Lupa's pinned Windows wheel passed SHA256 verification and exposes LuaJIT 2.1/Lua 5.1; LuaCov passed a synthetic runtime/line-coverage probe. This prepares P1 tooling, not plugin implementation or device acceptance. No other download is authorized.

## Historical next steps before B3 completion

1. Proceed to B3 reports, grouping, goals and backup/restore under the one-active-feature rule. Existing approved dependencies suffice; no additional download is authorized.
2. B3 checkpoint contains allocation validation, book list/detail, grouping/matching, goals, vocabulary and draft backup/restore with migration 003. Finish reporting and source/progress/session/cycle/annotation list APIs, strengthen backup validation/tests and satisfy the current >=80% gate. File presence is not completion; the private task-5 report predates several changes.
3. Reproduce the vocabulary reset issue: a word saved again after an empty new-generation baseline may remain permanently filtered by reset tombstones in sync-store.js. Confirm word identity/count semantics when only source metadata differs before changing persistence or migration behavior.
4. Complete full B3 self-review and independent review, register its verifier only after review, then run a fresh combined gate. Keep SQL persistence and device evidence distinct from unit coverage.
5. Continue the approved plan in order: P1/P2 plugin, F1/F2 panel, I1 assembled delivery and owner-run Kindle/database acceptance, I2 portable deployment and public-release checks. Deployment/publication still require separate instructions.

At each handoff update this file with verified results, blockers and the next concrete action. `passing` is written only by a verifier with an implemented gate; later sync/plugin/panel features have not passed yet.
