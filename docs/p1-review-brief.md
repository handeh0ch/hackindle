# P1 independent review brief

Status: prepared by the implementer for an independent reviewer. It is a map of the work and its risks, not a review, and it records no passing evidence. Only a verifier may mark P1 `passing`, and only after this review and its fixes.

## What P1 claims

Capture on the KOReader side, without fabricated data: source identity, reading history per source, native active time, annotations with context, saved vocabulary, legacy statistics, and the reset-generation protocol that lets the owner restart an instance. Nothing is sent yet (P2), the entrypoint is unconfigured, and nothing has run on a device. Treat every `koreader_*` adapter as an unverified assumption about KOReader internals.

## How to reproduce the evidence

```powershell
.local/harness-venv/Scripts/python.exe -B tests/plugin/verify.py   # Lua suite, oracles, LuaCov >=80% per module
.local/harness-venv/Scripts/python.exe -B scripts/check.py         # full gate, includes the Lua suite
node scripts/build-plugin.js                                        # assemble .local/build/kindle_sync.koplugin
```

Last recorded results: 29 Python, 35 contract and 155 server unit tests; Lua 98.25% aggregate lines (2581 hit, 46 missed), every module >=80%. Lua branch coverage, SQLite on the device, PostgreSQL and KOReader behavior are not measured. Coverage shows that lines ran, not that they are right.

## Where to look

| Area | Files | Role |
| --- | --- | --- |
| Entry and wiring | `plugin/main.lua`, `plugin/koreader_runtime.lua`, `plugin/app.lua` | KOReader events, source hashing job, facade over the stores |
| State | `plugin/state.lua`, `plugin/koreader_sqlite.lua`, `plugin/codec.lua`, `plugin/wire_json.lua` | transactional key/value store plus outbox table, pure-Lua JSON |
| Reading | `plugin/capture.lua`, `plugin/reading.lua`, `plugin/koreader_reading.lua`, `plugin/segment.lua`, `plugin/allocation.lua`, `plugin/tzif.lua`, `plugin/utc.lua` | credited ranges, native credit identities, page tokens, time allocation |
| Source | `plugin/source.lua`, `plugin/koreader_hash.lua`, `plugin/koreader_metadata.lua`, `plugin/identity.lua` | SHA-256 identity, metadata snapshot, ACK gating |
| Annotations | `plugin/annotations.lua`, `plugin/koreader_annotations.lua`, `plugin/koreader_context.lua`, `plugin/context.lua` | stable IDs via an injected binding, page context |
| Vocabulary and legacy | `plugin/vocabulary.lua`, `plugin/koreader_vocabulary.lua`, `plugin/legacy.lua`, `plugin/koreader_statistics.lua`, `plugin/unicode_lower.lua` | snapshots, baseline and epoch handshake, frozen casing |
| Reset protocol | `plugin/profile.lua`, `plugin/reset.lua`, reset paths in `capture.lua`, `annotations.lua`, `legacy.lua`; server side `server/sync-store.js` (`clear`, `establishLegacyBaseline`) | generation barrier, baselines, tickets |
| Sessions | `plugin/sessions.lua` | session, cycle and book-finished events |
| Packaging | `scripts/build-plugin.js` | prefixes local modules and ships only those reachable from `main.lua` |

Contracts the plugin must satisfy are in `contracts/` and [api-v1.md](api-v1.md); capture boundaries are in [koreader-adapter.md](koreader-adapter.md).

## KOReader assumptions that nothing has confirmed

1. `PageUpdate` precedes `DocumentRerendered` on a full rerender; `onEndOfBook` is the event name and fires when the last page is reached.
2. `getPageXPointer(page)`, `getPageXPointer(page + 1)` return distinct ordered XPointers, including past the last page; `compareXPointers` sign convention; `getTextFromXPointers` does not change position or selection.
3. `ui.statistics` exposes `page_stat`, `id_curr_book`, `curr_page`, `is_doc` and the statistics database row timing matches the plugin's clock to the exact second (`koreader_reading.lua` requires equality).
4. `lua-ljsqlite3` returns BLOB values as Lua strings, supports the `ro` flag and `blob()`; `ffi/sha2` incremental API; `getrandom` exists in the device libc.
5. `ui.annotation.annotations` is an ordered array whose entries have `pos0`, `pos1`, `text`, `note`, `chapter`, `datetime`, and a separately verified binding can give each a durable key (KOReader has no annotation ID).
6. Plugin directories put their own folder first on `package.path`, so the `kindle_sync_` module prefix resolves.

## Risks to examine first

1. **Reset and baseline protocol.** Generations, tickets, baselines, epochs and ACK gating span plugin and server and rest on injected evidence that does not exist yet (`native_epoch` continuity, complete native baselines, offline save chronology). Look for states that lose reading, double-credit it, or deadlock in `capture_generation = blocked`. Consider whether a simpler design (reset starts a new instance identity) removes the class of risk.
2. **Atomicity and crashes.** Page token (`native_page`), `recover`, early returns in `Entry:onCloseDocument`, `finishPage` failures, and the module-level `active` provider in `koreader_reading.lua` that stays set if a close path aborts.
3. **Double credit.** Range ledger (`reading.lua`, now pruned to the newest 8 days per source), per-key native credit rows (`rn:`, `ru:` with a chunked index), exact-second native tuple matching, `claim_event`.
4. **Source identity.** Two-pass hash with attribute checks is not a file lock; mutation after hashing, same-size edits, hashing cost on large PDFs.
5. **Annotation identity and context.** Dependence on an injected `key_for`; selection guard completeness; identical re-saves; context at the final page.
6. **Skipped identical snapshots** (new). Vocabulary and legacy statistics are not queued again when unchanged (`vocabulary_last`, comparison with the stored records) and refresh at most every 30 s. A server restored from an older backup is therefore not healed by the next suspend; the fix belongs with P2 acknowledgements.
7. **Time and timezone.** TZif parsing, midnight and DST splits, plugin and server allocation must agree (`server/allocation.js` is the second implementation, the Python and Lua oracles compare them).
8. **Error handling.** Most failures are caught by `Entry:call` and reduced to a status string plus a `logger.warn`; look for failures that should instead stop capture or surface to the user.
9. **Packaging.** Regex rewriting of `require` in `build-plugin.js` assumes literal module names; verify no dynamic or `pcall(require, ...)` form is missed.

## Questions for the reviewer

1. Can any sequence of suspend, resume, close, crash and reset lose a credited interval or credit it twice?
2. Is every fail-closed path actually closed, or can an `assert` inside a scheduler callback escape `pcall` (see `koreader_runtime.lua`, the `callback(adapter)` call)?
3. Do the plugin's wire objects match what `validateEnvelope` accepts for every kind, including the reset-path variants?
4. Is the reset protocol worth keeping as designed, or should P1 be simplified before P2 builds on it?
5. Which unverified assumptions above must be turned into owner-run observations in I1, and which should be removed from the design?

## Out of scope

P2 delivery (outbox draining, retries, TLS, settings UI), real PostgreSQL behavior, and device acceptance (I1). Server code is relevant only where it enforces the plugin's protocol.

## Known open defects (not fixed)

- Reset-path vocabulary snapshots still queue on every refresh.
- The range ledger grows within a single day when reading with many gaps.
- Statistics and vocabulary are still fully read on the UI thread when a refresh runs.
- `Entry:attach` raises inside the source-hash callback when a pending page exists.
- Re-read cycles are never started by any code; only `book_finished` is emitted on `EndOfBook`.
- `ffi.cdef` for `getrandom` runs on every UUID request, and no `/dev/urandom` fallback exists by design.
