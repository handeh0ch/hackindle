# Session handoff

Hard limit: this file MUST contain at most 70 lines, including headings and blank lines. Update it before every agent handoff; replace stale context and link to authoritative files instead of copying them. The receiving agent reads AGENTS.md first, then this file, and checks the actual Git status.

## Current context

- Updated: 2026-11-02. Baseline: local main `0611833`; use Git history/status for the current branch and commit.
- Project: Kindle Sync, a self-hosted KOReader archive/dashboard. Production server, plugin and panel are not implemented.
- H01 harness is implemented. AGENTS.md follows six English template sections; detailed workflow/environment guidance is in [development.md](development.md).
- The verification gate requires this file to exist and rejects more than 70 lines before running tools or recording passing evidence.

## Verification

- Run `make check`: unit tests, >=90% harness statement/branch coverage, registry/handoff validation and diff checks.
- See [../feature_list.json](../feature_list.json) for verifier-written evidence and [../PROGRESS.md](../PROGRESS.md) for verified results and blockers.
- Coverage currently measures `scripts/` only. Application, diagnostic Lua and hardware behavior remain outside that percentage.

## Next action

1. Read the latest [compatibility status](testing/compatibility-status.md) and prepare/review P0 synthetic diagnostic instructions.
2. Wait for owner-run device observations; do not assume unverified adapters work.
3. Freeze C0 contracts after P0, then follow the [application plan](superpowers/plans/2026-11-01-kindle-sync.md) with its older E2E/integration steps overridden by the unit-only policy.

## Boundaries and references

- Downloads need concrete owner approval; installs/caches/temp/builds stay on agreed P: paths. The owner performs every Kindle write.
- Publication needs separate instruction. Keep credentials, personal books and reading data outside public artifacts.
- Required detail: [development.md](development.md), [requirements.md](requirements.md), [kindle-sync-data-spec.md](kindle-sync-data-spec.md), [configuration.md](configuration.md), [harness.md](harness.md).
