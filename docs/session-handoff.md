# Session handoff

Read AGENTS.md first, then this handoff, PROGRESS.md and feature_list.json. Check actual Git status. This file must remain at most 70 lines.

## Current state

- Updated 2026-11-03. B3 reports, grouping, goals and backup/restore are implemented and independently reviewed. See the actual Git history for its commit.
- A fresh `make check` passed with 26 Python, 34 contract and 132 server unit tests; server coverage 97.84% lines / 86.31% branches / 93.29% functions. Only the verifier records passing evidence in feature_list.json.
- B3 supplies daily/summary reporting, source, progress, session, cycle and annotation lists, grouping, goals and credential-free backup/restore. Restore checks policy, identity, versions, reset barriers and empty target.
- Vocabulary identity is case-insensitive word plus language; source does not affect unique count. API v1 documents normalization. A regression test covers explicit re-save after reset and baseline, including changed case/source and repeated resets.
- Old reset tombstones containing only full-object fingerprints cannot identify changed metadata or case. Client baseline correctness remains essential for those historic barriers.
- Review fixes include restore allocation/generation validation, reporting-date domain checks, aggregate overflow handling and bounded list projections. Unit mocks do not execute SQL.

## Next action

1. Follow the owner-approved order: P1/P2 KOReader plugin, F1/F2 panel, I1 owner-run assembled acceptance, I2 release and deployment guidance. One active feature at a time.
2. The owner performs all Kindle writes and deferred device observations. Real PostgreSQL syntax/concurrency, cross-database restore, Node 24, deployment and device operation remain unverified.
3. Use unit-only automated tests and >=80% coverage. Do not start a real database, HTTP server, container or browser E2E suite.
4. Downloads require separate approval for each concrete item; installs, caches and temporary files stay on agreed P: paths. No further downloads are authorized.
5. No push, publication or deployment without separate owner instruction. Keep credentials, private configuration, personal books and reading data out of Git.
6. Read docs/development.md and relevant requirements, data, configuration, harness and approved plan before implementation. Maintain repository documents in English.
