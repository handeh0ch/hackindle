# Session handoff

Read AGENTS.md first, then PROGRESS.md and feature_list.json; inspect Git status and history.

## Current state

- 2026-11-06: owner requested a local WIP checkpoint of all current changes. P1 remains active with null verifier/evidence; P2 is not started. This checkpoint is not a completed feature and must not run as a service.
- B3 baseline is 95e7d17; previous unfinished P1 checkpoint is 24a6d12. Inspect the current commit and diff before continuing. No push, deployment, publication or Kindle writes are authorized.
- Fresh `scripts/check.py` passed the existing unit gates on this WIP; P1 is not registered. The separate unregistered `tests/plugin/verify.py` passed synthetic tests and oracles with 98.29% aggregate Lua lines (2,527 hit / 44 missed), every executable module >=80%; Lua branches, SQL and device behavior are unverified.
- Legacy reset baseline/epoch, server storage, migration and backup handling are provisional. Generation-zero untagged high-water is a conservative exclusion floor and can under-credit; exact source binding and continuous native epoch require evidence. Old queues, resets, backup/restore, limits and races need independent re-review.
- The KOReader entrypoint and adapters are WIP. Rolling text has tentative page tokens, context extraction and synthetic time capture. PDF has a guarded native-time path but no character-volume implementation. Native seconds require an exact source/book/epoch binding and a unique native tuple; real ordering and device behavior are unverified.
- Reading reset has a ticketed injected complete-baseline path; legacy reset has baseline/ACK/snapshot orchestration. Neither has a production provider that proves all required native baseline and epoch evidence. Annotation and vocabulary reset paths need reliable save signals and offline reset chronology; identical re-saves remain at risk of being unclassified.
- Native association is injected; source mutation after hashing, same-attribute changes, selection safety, final CRE page boundary, and cross-process locking remain unresolved. Durable gap counts do not recover lost reading during hash, ACK delays, crashes or close failures. See docs/koreader-adapter.md, noting that some descriptions predate the newest native-time code.
- Authenticated ACK transport/configuration remains P2; default entrypoint is unconfigured. Do not infer device support from synthetic adapters. Owner-run hardware observations are deferred to I1.
- The latest native-time/PDF-time and reading-reset changes have focused synthetic tests but have not received independent review. P1 verifier must stay null until implementation and independent review are complete; only a verifier can record passing evidence.
- 2026-11-06 review wave 1 is applied but uncommitted: frozen server Unicode casing, snapshot reads without instance locks, owner device unbind, scripts/build-plugin.js packaging and plugin error logging. Second-wave review items (per-page state cost, book-finished/cycle events, suspend-time rereads, auth hardening, backup drift) remain open; see PROGRESS.md.

## Next steps

1. Resume with gpt-6.1-terra/high implementer and separate independent reviewer; do not substitute models or buy access. Read docs/development.md, requirements, data spec, api-v1, configuration, harness and the approved P1/P2 plan before implementing.
2. Finish P1 capture and reset correctness, including PDF visible text, native time/epoch, stable annotation identity/context, durable observation recovery and verified source binding. Keep uncertain device API assumptions explicit for I1; do not fabricate measurements.
3. Independently review the entire P1 WIP and repair findings; register the implemented Lua verifier only after completion and review, run a fresh full gate, and follow staged diff/redacted secret scan before the P1 commit.
4. Only then implement and independently review P2, run its verifier and a fresh full gate, and commit locally. Unit tests only; never start a real database, service, container, browser E2E or device.
5. No downloads without specific approval. Use agreed P: paths, keep private data out of Git, and maintain repository documentation in English.
