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
- Reviewer package: docs/p1-review-brief.md. PostgreSQL smoke test and upstream KOReader source check results are in PROGRESS.md (2026-11-07 entries).

## Next steps

1. Owner: assign an independent reviewer for P1 and P2 using docs/p1-review-brief.md and docs/p2-design.md; fix findings; then register the verifier and run a fresh full gate.
2. Owner: confirm or change the five P2 defaults (blocking requests, settings file, TLS reliance, no queue cap, event-driven progress).
3. Owner-run I1 items listed in docs/plugin-install.md (TLS verification first).
4. Open housekeeping: optional tests/smoke scripts, Docker image build and digest pin (needs download approval), reviewing the reset protocol simplification.
5. Unit tests only; no downloads without specific approval; agreed P: paths; private data out of Git; documentation in English.
