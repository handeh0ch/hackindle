# Session handoff

Read AGENTS.md first, then this file, PROGRESS.md and feature_list.json; inspect Git status. Limit: 70 lines including blanks.

## Current state

- Updated 2026-11-04. B3 baseline is commit 95e7d17; the subsequent WIP checkpoint saves unfinished P1 and legacy changes. Check actual Git history and status. P1 is active; verifier and evidence are null.
- The requested gpt-6.1-terra/high backend implementer hit its usage limit while changing the legacy reset protocol. No different model or paid option is authorized. Resume the same model when available.
- CRITICAL: legacy implementation is partial. `server/sync.js` calls `legacyBaseline` and `establishLegacyBaseline`, but `server/sync-store.js` does not implement them. Migration 004, schema and tests are incomplete; backup/restore and end-to-end unit coverage are incomplete. Do not run/deploy this checkout as a service or claim B3 remains unaffected without verification.
- Fresh `make check` on the WIP state FAILED: 35 contract tests passed; 133 of 134 server tests passed, with `tx.establishLegacyBaseline is not a function`. P1 is not registered and no passing evidence was written.
- Owner chose an explicit baseline/epoch extension for legacy after reset. A complete, durable per-source baseline must precede raw snapshots; for the same verified native lineage use componentwise max of server highwater and client baseline. Preserve generation-0 initial legacy import, pause on unknown native epoch/regression, reject unsafe new untagged writes, and preserve old exact retry/conflict/obsolete-generation behavior. Never accept partial or oversized baselines.
- Review baseline identity/digest/version, reset ordering, unavailable and unseen rows, 16 MiB limits, integer safety, multiple resets, backups/restores and compatibility. Contract and service edits need independent review and a fresh complete gate before any passing claim.
- P1 has synthetic-tested Lua primitives: validator, timezone TZif allocation, SQLite/KOReader adapters, snapshots, reading and lifecycle, and an opt-in vocabulary reset barrier. Last focused review addressed read-ticket races; app/reset/P2 integration remains incomplete.
- Important open P1 gaps: device-local/native adapters and hooks, actual SHA/entropy and stable file reading, verified native epoch, full Unicode identity, reset resume for all datasets, annotation identical re-save proof, and authenticated source metadata acknowledgements. Real SQLite, timezone data and device behavior are unverified. Do not register P1 verifier before completion and independent review.
- Older vocabulary reset full-object fingerprints cannot identify altered metadata; correct native baselines are essential. An annotation identical re-save remains blocked by retained server fingerprints and needs an explicit safe evidence protocol and verified native signal.

## Next steps

1. Resume the requested model; finish legacy server/contract implementation and backup migration; test with unit doubles only. Preserve all current changes and inspect the actual diff before continuing.
2. Independently review and repair the protocol and P1 implementation; finish plugin wiring, register an implemented >=80% verifier only after review, run fresh `make check`, staged diff and redacted secret scans before the owner-requested local commit.
3. Then P2, F1/F2, I1 owner-run acceptance, I2 release/deployment guidance. One active feature at a time.
4. No downloads without specific approval; all tooling/cache/temp on agreed P: paths. No actual database, server, browser E2E or container tests. Owner performs every Kindle write.
5. No push, publication or deployment without separate owner instruction. Keep private data and credentials out of Git; maintain repository documents in English.
