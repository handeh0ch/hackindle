# Session handoff

Hard limit: this file MUST contain at most 70 lines, including headings and blank lines. Update it before every agent handoff; replace stale context and link to authoritative files instead of copying them. The receiving agent reads AGENTS.md first, then this file, and checks the actual Git status.

## Current context

- Updated: 2026-11-03. B2 baseline: `45e6f21`; the subsequent main checkpoint saves unfinished B3. Resolve its hash through Git history and check status before continuing.
- Project: Kindle Sync, a self-hosted KOReader archive/dashboard. Server/auth and ingestion/archive are unit-verified; reports, production plugin and panel are pending.
- H01 harness is implemented. AGENTS.md follows six English template sections; detailed workflow/environment guidance is in [development.md](development.md).
- All repository documentation/plans must be maintained in English. Existing Russian research notes and the application plan are translated; their technical literals, source targets and task states are preserved.
- The verification gate requires this file to exist and rejects more than 70 lines before running tools or recording passing evidence.

## Verification

- Run `make check`: unit tests, >=90% harness statement/branch coverage, registry/handoff validation and diff checks.
- See [../feature_list.json](../feature_list.json) for verifier-written evidence and [../PROGRESS.md](../PROGRESS.md) for verified results and blockers.
- Coverage measures harness Python, executable contracts and implemented server/entry JavaScript separately. SQL, diagnostic Lua and hardware behavior remain outside those percentages.
- Checkpoint verification: `make check` FAILED the server branch gate (86.83%, required 90%); lines 98.11%, functions 94.33%. Python: 26 passed, 98.10% combined coverage. See PROGRESS.md for counts. No B3 passing evidence was recorded.

## Next action

1. B2 is committed at 45e6f21 after clean review, 24 Python/33 contract/74 server units and staged secret scan. B3 reports/grouping/goals/backup is the sole active feature. Read task-5-brief.md in the private task directory; no plugin or panel implementation yet.
2. The owner deferred manual Kindle checks until the assembled application is ready. P0 remains open hardware evidence, not a dependency blocking C0; unverified adapters must remain explicit.
3. Apply the unit-only testing policy and >=90% coverage gate to new executable code. No automated browser, database integration or E2E suites.
4. Backend role continues sequentially in P:/Code/hackindle to reuse the approved node_modules location. Backend owns server/, db/, application scripts/tests and package files; coordinator reserves scripts/check.py, tests/unit/, registry, docs and Git. No concurrent Git mutations.
5. B3 must recompute allocation against the initialized policy. The pre-release checkpoint bounds service UTC instants to years 0001-9999, seconds 00-59, up to 9 fractional digits; each segment has at most 366 allocation dates. See API v1; preserve exact accepted fractions, reject local dates outside the domain.
6. B3 worker has temporary narrow contract/schema/test ownership for this timestamp checkpoint. Data/identity/reset barriers must survive export/import without credentials. Detail timestamp remains a bounded display value; full exact timestamp stays in paged context.
7. Allocation checkpoint passed scoped re-review after fix round 1, with the documented IANA transition-spacing assumption; report task-5-allocation-fix-1-review.md. Other B3 work continues; no full B3 delivery or passing claim. See private task-5-report.md.
8. The requested gpt-6.1-terra/high backend subagent stopped at its usage limit. Its report is stale; inspect actual code/tests. No paid upgrade or model substitution is authorized. Resume the original B3 task rather than restarting completed work.
9. Checkpoint includes book list/detail, grouping/matching, goals, vocabulary, allocation, migration 003 and draft backup/restore CLI. Remaining B3: reporting APIs; source/progress/session/cycle/annotation lists; backup validation/coverage, full self-review and independent review. Confirm completeness against the approved plan, not file presence.
10. Investigate vocabulary reset regression before completion: save W, reset, accept new-generation empty baseline, then explicitly save W again. sync-store vocabulary currently filters reset_tombstones forever; this may suppress legitimate post-baseline saves. Reproduce first. Unique saved-word count must not inflate merely from differing source metadata; finalize identity semantics before changing hashes/migrations.
11. Next sequence: finish B3 and reach coverage >=90%; independent review/fixes; register its verifier only after review; fresh make check and commit. Then P1/P2 plugin, F1/F2 panel, I1 owner-run acceptance and I2 release/deployment guides. The approved detailed plan remains docs/superpowers/plans/2026-11-01-kindle-sync.md (relative to repository root).

## Boundaries and references

- Downloads need concrete owner approval; installs/caches/temp/builds stay on agreed P: paths. The owner performs every Kindle write.
- Approved for C0: npm registry packages ajv 8.17.1, ajv-formats 3.0.1 and their dependencies, only in P:/Code/hackindle/node_modules with cache/temp under .local/. Run no install scripts; no other tool/package download is approved.
- Approved for B1: npm registry express 5.3.0, pg 8.23.1 and their dependencies in the same P: paths, with install scripts disabled. No runtime, PostgreSQL server, image or browser download is approved.
- Owner subsequently approved Lupa 2.8 and LuaCov 0.17.0 under .local/ on P:. Installed/probed there; see private p1-runtime-preflight.md. This is future P1 tooling, not device evidence. No further download is authorized.
- Publication needs separate instruction. Keep credentials, personal books and reading data outside public artifacts.
- Required detail: [development.md](development.md), [requirements.md](requirements.md), [kindle-sync-data-spec.md](kindle-sync-data-spec.md), [configuration.md](configuration.md), [harness.md](harness.md).
