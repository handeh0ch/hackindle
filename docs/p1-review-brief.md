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

## KOReader assumptions and what upstream source says

Source: public KOReader files at tag v2026.07.1, read on 2026-11-07 by a documentation-reading subagent and summarised; I did not re-read them myself, and nothing here was observed on a device. "Upstream" below means that source, not the owner's installed build. `base/` (ffi, TLS, ljsqlite3) is a separate submodule that could not be read.

| Assumption in the plugin | What upstream reports | Status |
| --- | --- | --- |
| `PageUpdate` precedes `DocumentRerendered` on a full rerender | Yes (rolling `updatePos`: goto, then `DocumentRerendered`; a code comment says statistics relies on it) | confirmed |
| `onEndOfBook` fires when the last page is reached | The event `EndOfBook` is sent by a forward turn that cannot move (rolling `onGotoViewRel`, paged `onGotoPageRel`/`onScrollPageRel`), not on arrival at the last page; the only core handler is `ReaderStatus:onEndOfBook`, which may show a pop-up | event name confirmed, timing corrected |
| `PageUpdate` always fires | Not in rolling scroll mode: it sends `PosUpdate` instead; page mode and paged documents send `PageUpdate(page[, orig_mode])` | contradicted for scroll mode |
| `ui.statistics.page_stat`, `id_curr_book`, `curr_page`, `is_doc` exist | Yes; `page_stat[page]` is a list of `{start, duration}`, start from `os.time()` (integer seconds), duration added on the next page turn and only kept if between `min_sec` (5) and `max_sec` (120, capped); entries are volatile and flushed to the database every 50 page turns, on close, suspend and others | confirmed, with caveats below |
| Exact-second equality between the plugin's page start and the statistics start | Both use whole seconds, but they come from two handlers of the same event; no ordering guarantee was found | unverified, fragile |
| `page_stat_data` columns and file | `id_book, page, start_time, duration, total_pages` with `UNIQUE(id_book, page, start_time)`, in `statistics.sqlite3` in the settings directory; `page_stat` is a view | confirmed |
| `ui.annotation.annotations` entries and event | Entries have `pos0, pos1, text, note, chapter, datetime, page, drawer, color, ...`; event `AnnotationsModified` carries a table with positional items plus named keys such as `nb_highlights_added`, `index_modified` (the latter seen only in a summary) | confirmed |
| KOReader has no annotation ID | Confirmed: items are matched by datetime, page and positions | confirmed |
| Vocabulary Builder file and columns | `vocabulary_builder.sqlite3` in the settings directory; table `vocabulary` with `word` unique and no language or dictionary column; the file is switched to WAL when the device allows it | confirmed; read-only open of a WAL file is unverified |
| Plugin directory is first on `package.path` | Only while `main.lua` is loaded; afterwards it is appended to the end, so a later `require` finds core modules first | contradicted, which makes the `kindle_sync_` prefix necessary |
| `_meta.lua` carries the plugin name | A `name` there is ignored with a deprecation warning; the directory name (without `.koplugin`) is the name | contradicted; our `_meta.lua` still sets it |
| Errors inside a scheduled callback are contained | `UIManager` runs tasks without `pcall`; an error leaves the main loop and, with the turbo loop, ends the process | contradicted; fixed in `koreader_runtime.lua` (see known defects) |
| `getPageXPointer(page + 1)` past the last page, `compareXPointers` sign, `getTextFromXPointers` side effects | Not examined | unverified |
| `ffi/sha2` incremental API, `lua-ljsqlite3` (`ro` mode, BLOB as string, `blob()`), `getrandom` in the device libc | The files live in the `base` submodule, which could not be read | unverified |

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
2. Is every fail-closed path actually closed? Upstream shows that an `assert` inside a scheduler callback is not contained (see `koreader_runtime.lua`, the `callback(adapter)` calls); are there other unprotected entry points?
3. Do the plugin's wire objects match what `validateEnvelope` accepts for every kind, including the reset-path variants?
4. Is the reset protocol worth keeping as designed, or should P1 be simplified before P2 builds on it?
5. Which unverified assumptions above must be turned into owner-run observations in I1, and which should be removed from the design?

## Out of scope

P2 delivery (outbox draining, retries, TLS, settings UI), real PostgreSQL behavior, and device acceptance (I1). Server code is relevant only where it enforces the plugin's protocol.

## Known open defects (not fixed)

Raised by the upstream source check:

- **Fixed after the upstream check: scheduled errors can no longer end the reader.** `UIManager` runs scheduled callbacks without `pcall`. In `koreader_runtime.lua` every call of the caller's callback now goes through a guarded `deliver`, and the whole scheduled hashing step runs under `pcall`; an unexpected error cancels the source and reports `source_unavailable`. Two tests cover a raising callback and an unexpected error inside a step, and fail on the previous code. Other scheduled entry points do not exist yet; P2 must follow the same rule.
- **Scroll mode is silently not captured.** Rolling documents in continuous scroll send `PosUpdate`, not `PageUpdate`; the entry has no `onPosUpdate`, so nothing is credited and no gap is recorded. Either handle `PosUpdate` or detect scroll mode and say so.
- **Native timing depends on handler order.** `koreader_reading.lua` needs `row[2] > 0` for the previous page, but the statistics plugin adds that duration inside its own `onPageUpdate`. If the plugin handles the event first, the duration is still 0 and the page falls back to unavailable timing. Entries also vanish from `page_stat` when the statistics plugin flushes (every 50 turns, on suspend and close), and durations under 5 s are never kept. Real native credit is therefore likely sparse.
- **`EndOfBook` semantics.** It fires on a forward turn past the end, and `ReaderStatus` may show its pop-up at the same time; a book that is only read to its last page does not emit it.
- **Deprecated `_meta.lua` name.** KOReader ignores it and logs a warning; the directory name decides, so installs must use `kindle_sync.koplugin`.

Earlier items:

- Reset-path vocabulary snapshots still queue on every refresh.
- The range ledger grows within a single day when reading with many gaps.
- Statistics and vocabulary are still fully read on the UI thread when a refresh runs.
- Re-read cycles are never started by any code; only `book_finished` is emitted on `EndOfBook`.
- `ffi.cdef` for `getrandom` runs on every UUID request, and no `/dev/urandom` fallback exists by design.
