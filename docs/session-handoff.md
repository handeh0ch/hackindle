# Session handoff

Read AGENTS.md first, then PROGRESS.md and feature_list.json; inspect Git status and history.

## Current state

- 2026-11-08: on the owner's instruction ("complete P1 and P2") the open P1 defects were closed or recorded as limits and P2 was implemented. No push, deployment, publication or Kindle write is authorized. Whether the working tree is committed: check Git status.
- P1 changes: continuous scroll mode now records one durable capture gap and credits nothing (no visible-range provider can be verified without a device); reset-path vocabulary snapshots with an unchanged set are not queued again; `_meta.lua` no longer sets the ignored `name`. Native time stays sparse by design (measured from server data in I1).
- P2 (design and owner defaults: docs/p2-design.md, owner steps: docs/plugin-install.md): ordered outbox delivery with persisted pause/backoff/chunk-upload state, acknowledgement matching (differential oracle against `matchesAck`, 441 cases), idempotent ack hooks, injected transport, owner-placed `kindle_sync.conf` (parsed, never executed), profile cache with server-change detection, timer with bounded flush at close, menu (status, sync now, finish book, new read cycle), zip packaging.
- Latest `scripts/check.py` passed: 29 Python, 35 contract and 158 server tests; Lua 98.47% aggregate lines, every module >=80%. SQL on real PostgreSQL, Kindle behavior, TLS verification and every network call to a real server are unverified.
- Registry: P1 stays active with null verifier/evidence and P2 stays not_started. Both need the independent review the owner assigns; the implementer must not substitute a reviewer. Only a verifier may record passing.
- Not captured yet: scroll mode, native time, annotations and legacy statistics (they need device-verified bindings), reading after a server reset (needs a verified native epoch). The default entrypoint does nothing without the settings file.
- Earlier risks still apply: the reset-generation protocol is the largest complexity (consider "reset = new instance identity"), a server restored from an older backup is not healed by unchanged-snapshot skipping, full statistics/vocabulary reads happen on the UI thread, ffi/sha2, ljsqlite3 `ro`/BLOB and TLS are unread in the base submodule.
- 2026-11-08 independent review done (read-only subagent): see docs/p1-review-brief.md. Fixed: close-flush reopen, guarded menu callbacks, redirects, total timeout, fractional ack generation, pcall(require) packaging. Findings 1 and 5 were then decided (owner: "decide now"): generation-0 capture needs only the queued metadata snapshot; a reset generation above 0 stops capture (reset_unsupported) while the old queue drains. The P1 reset protocol itself is unchanged and still needs the real review.
- Reviewer package: docs/p1-review-brief.md. PostgreSQL smoke test and upstream KOReader source check results are in PROGRESS.md (2026-11-07 entries).

## Update 2026-11-08 (later): Step A closed

- P1 and P2 are registered `passing` by the verifier on unit evidence after two independent read-only reviews; device items stay in I1. The owner confirmed: plan Task 7 amended to event-driven progress, the five P2 defaults and the reset behavior stand, page mode only. Work is uncommitted until the owner asks.
- Fixed since the earlier review: session-open retry, lease release on CloseWidget, upload kept across resume, 404 upload_not_found, one-time pause message, stale deferred page, idempotent server upload create (new SQL, not run on PostgreSQL). Last gate: 34 Python, 35 contract, 159 server tests, Lua 98.46%.
- `.gitignore` covers `kindle_sync.conf`. Gitleaks 8.30.1 (full history) found nothing; the plugin zip has no URL or credential.

## Next steps

1. F1 and F2 are registered passing (`public/`, `npm run test:panel`, 175 tests; reviewed). Next: I1 (`docs/testing.md`, compatibility report template; coordinator work, owner runs the device), then I2 (release preparation, no publication). The panel has never run against a real server and PostgreSQL; it was only viewed against synthetic stubs.
2. Owner-run I1 items listed in docs/plugin-install.md (TLS verification and CloseDocument/CloseWidget order first).
3. Open housekeeping: Docker image build and digest pin (needs download approval), reset protocol simplification after device checks.
4. Unit tests only; no downloads without specific approval; agreed P: paths; private data out of Git; documentation in English.
