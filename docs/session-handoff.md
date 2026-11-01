# Session handoff

Hard limit: this file MUST contain at most 70 lines, including headings and blank lines. Update it before every agent handoff; replace stale context and link to authoritative files instead of copying them. The receiving agent reads AGENTS.md first, then this file, and checks the actual Git status.

## Current context

- Updated: 2026-11-02. Backend foundation baseline: local main `129645c`; shared C0 is `07b0c23`. Check actual Git status.
- Project: Kindle Sync, a self-hosted KOReader archive/dashboard. Server/auth foundation is unit-verified; sync ingestion, reports, production plugin and panel are pending.
- H01 harness is implemented. AGENTS.md follows six English template sections; detailed workflow/environment guidance is in [development.md](development.md).
- All repository documentation/plans must be maintained in English. Existing Russian research notes and the application plan are translated; their technical literals, source targets and task states are preserved.
- The verification gate requires this file to exist and rejects more than 70 lines before running tools or recording passing evidence.

## Verification

- Run `make check`: unit tests, >=90% harness statement/branch coverage, registry/handoff validation and diff checks.
- See [../feature_list.json](../feature_list.json) for verifier-written evidence and [../PROGRESS.md](../PROGRESS.md) for verified results and blockers.
- Coverage currently measures `scripts/` only. Application, diagnostic Lua and hardware behavior remain outside that percentage.

## Next action

1. B1 passed review and the combined gate (22Python/29contracts/37server) at 129645c. B2 ingestion/archive/uploads/reset is the sole active feature; no reporting or panel work yet. Private task artifacts are under .superpowers/sdd/2026-11-01-kindle-sync/.
2. The owner deferred manual Kindle checks until the assembled application is ready. P0 remains open hardware evidence, not a dependency blocking C0; unverified adapters must remain explicit.
3. Apply the unit-only testing policy and >=90% coverage gate to new executable code. No automated browser, database integration or E2E suites.
4. Backend role continues sequentially in P:/Code/hackindle to reuse the approved node_modules location. Backend owns server/, db/, application scripts/tests and package files; coordinator reserves scripts/check.py, tests/unit/, registry, docs and Git. No concurrent Git mutations.

## Boundaries and references

- Downloads need concrete owner approval; installs/caches/temp/builds stay on agreed P: paths. The owner performs every Kindle write.
- Approved for C0: npm registry packages ajv 8.17.1, ajv-formats 3.0.1 and their dependencies, only in P:/Code/hackindle/node_modules with cache/temp under .local/. Run no install scripts; no other tool/package download is approved.
- Approved for B1: npm registry express 5.3.0, pg 8.23.1 and their dependencies in the same P: paths, with install scripts disabled. No runtime, PostgreSQL server, image or browser download is approved.
- Publication needs separate instruction. Keep credentials, personal books and reading data outside public artifacts.
- Required detail: [development.md](development.md), [requirements.md](requirements.md), [kindle-sync-data-spec.md](kindle-sync-data-spec.md), [configuration.md](configuration.md), [harness.md](harness.md).
