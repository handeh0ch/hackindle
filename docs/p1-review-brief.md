# P1 independent review brief

Status: prepared by the implementer for an independent reviewer. It is a map of the work and its risks, not a review, and it records no passing evidence. Only a verifier may mark P1 `passing`, and only after this review and its fixes.

## What P1 claims

Capture on the KOReader side, without fabricated data: source identity, reading history per source, native active time, annotations with context, saved vocabulary, legacy statistics, and the reset-generation protocol that lets the owner restart an instance. Nothing is sent yet (P2), the entrypoint is unconfigured, and nothing has run on a device. Treat every `koreader_*` adapter as an unverified assumption about KOReader internals.

## How to reproduce the evidence

```powershell
.local/harness-venv/Scripts/python.exe -B tests/plugin/verify.py   # Lua suite, oracles, LuaCov >=80% per module
.local/harness-venv/Scripts/python.exe -B scripts/check.py         # full gate, includes the Lua suite
node scripts/build-plugin.js                                        # assemble .local/build/hackindle.koplugin
```

Last recorded results (2026-11-08): 29 Python, 35 contract and 158 server unit tests; Lua 98.47% aggregate lines (3096 hit, 48 missed), every module >=80%, the new acknowledgement differential oracle (441 cases) included. Lua branch coverage, SQLite on the device, PostgreSQL and KOReader behavior are not measured. Coverage shows that lines ran, not that they are right.

## Where to look

| Area | Files | Role |
| --- | --- | --- |
| Entry and wiring | `projects/plugin/main.lua`, `projects/plugin/koreader/koreader_runtime.lua`, `projects/plugin/app.lua` | KOReader events, source hashing job, facade over the stores |
| State | `projects/plugin/storage/state.lua`, `projects/plugin/koreader/device/koreader_sqlite.lua`, `projects/plugin/protocol/codec.lua`, `projects/plugin/protocol/wire_json.lua` | transactional key/value store plus outbox table, pure-Lua JSON |
| Reading | `projects/plugin/reading/capture.lua`, `projects/plugin/reading/reading.lua`, `projects/plugin/koreader/capture/koreader_reading.lua`, `projects/plugin/reading/segment.lua`, `projects/plugin/time/allocation.lua`, `projects/plugin/time/tzif.lua`, `projects/plugin/time/utc.lua` | credited ranges, native credit identities, page tokens, time allocation |
| Source | `projects/plugin/snapshots/source.lua`, `projects/plugin/koreader/device/koreader_hash.lua`, `projects/plugin/koreader/capture/koreader_metadata.lua`, `projects/plugin/protocol/identity.lua` | SHA-256 identity, metadata snapshot, ACK gating |
| Annotations | `projects/plugin/snapshots/annotations.lua`, `projects/plugin/koreader/capture/koreader_annotations.lua`, `projects/plugin/koreader/capture/koreader_context.lua`, `projects/plugin/snapshots/context.lua` | stable IDs via an injected binding, page context |
| Vocabulary and legacy | `projects/plugin/snapshots/vocabulary.lua`, `projects/plugin/koreader/capture/koreader_vocabulary.lua`, `projects/plugin/snapshots/legacy.lua`, `projects/plugin/koreader/capture/koreader_statistics.lua`, `projects/plugin/text/unicode_lower.lua` | snapshots, baseline and epoch handshake, frozen casing |
| Reset protocol | `projects/plugin/protocol/profile.lua`, `projects/plugin/storage/reset.lua`, reset paths in `capture.lua`, `annotations.lua`, `legacy.lua`; server side `projects/server/sync/sync-store.js` (`clear`, `establishLegacyBaseline`) | generation barrier, baselines, tickets |
| Sessions | `projects/plugin/reading/sessions.lua` | session, cycle and book-finished events |
| Packaging | `scripts/build-plugin.js` | prefixes local modules and ships only those reachable from `main.lua`; `--zip` archives them |
| Delivery (P2, added after the review brief was first written) | `projects/plugin/delivery/delivery.lua`, `projects/plugin/delivery/transport.lua`, `projects/plugin/delivery/settings.lua`, `projects/plugin/koreader/koreader_client.lua`, `projects/plugin/koreader/device/koreader_http.lua`, `projects/plugin/koreader/device/koreader_network.lua`, `projects/plugin/koreader/device/koreader_format.lua`, `Entry:applyAck` in `main.lua` | ordered outbox delivery, ack matching, retries, uploads, profile cache, timer; see [p2-design.md](p2-design.md) |

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
| Plugin directory is first on `package.path` | Only while `main.lua` is loaded; afterwards it is appended to the end, so a later `require` finds core modules first | contradicted, which makes the `hackindle_` prefix necessary |
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
7. **Time and timezone.** TZif parsing, midnight and DST splits, plugin and server allocation must agree (`projects/server/sync/allocation.js` is the second implementation, the Python and Lua oracles compare them).
8. **Error handling.** Most failures are caught by `Entry:call` and reduced to a status string plus a `logger.warn`; look for failures that should instead stop capture or surface to the user.
9. **Packaging.** Regex rewriting of `require` in `build-plugin.js` assumes literal module names; verify no dynamic or `pcall(require, ...)` form is missed.

## Questions for the reviewer

1. Can any sequence of suspend, resume, close, crash and reset lose a credited interval or credit it twice?
2. Is every fail-closed path actually closed? Upstream shows that an `assert` inside a scheduler callback is not contained (see `koreader_runtime.lua`, the `callback(adapter)` calls); are there other unprotected entry points?
3. Do the plugin's wire objects match what `validateEnvelope` accepts for every kind, including the reset-path variants?
4. Is the reset protocol worth keeping as designed, or should P1 be simplified before P2 builds on it?
5. Which unverified assumptions above must be turned into owner-run observations in I1, and which should be removed from the design?

## Out of scope

P2 transport details (retry policy, uploads, TLS), real PostgreSQL behavior, and device acceptance (I1). Server code is relevant only where it enforces the plugin's protocol.

## Independent review result (2026-11-08)

A fresh read-only reviewer subagent (no chat history) reviewed commit 1bcf857. It found no path that deletes an unacknowledged packet, sends one to another instance or credits an interval twice, and said P1 and P2 must not be registered yet. Fixed afterwards: the close-time delivery flush could reopen a session through an ack (a `closing` flag now routes acks to app-level hooks only); the Status and Sync now menu callbacks are guarded (KOReader runs them without pcall); requests set `redirect = false`, a 3xx pauses delivery and the total timeout is also checked in the sink; a fractional `current_reset_generation` is no longer an acknowledgement (oracle mutations added, 483 cases); the build follows `pcall(require, "module")`. Decided by the owner ("decide now", taking the implementer's recommendation) and applied afterwards: (1) at generation 0 capture needs only the queued source metadata snapshot (`source.assert_known`), not its acknowledgement, because the strictly ordered outbox delivers the snapshot first; offline first sessions, annotation import and legacy import no longer wait; after a reset the acknowledgement is still required; (2) at a reset generation above 0 the shipped wiring stops capture with the status `reset_unsupported` (no baseline providers exist), still delivers the old queue so the server discards it, and does not touch the unreachable P1 reset code, which stays unreviewed and unverified. The reset-protocol simplification question stays open for the real review. Lower findings, fixed afterwards (2026-11-08, each with a test that failed first): a failed `lifecycle("open")` is retried from `onPageUpdate`; `resume()` keeps an open upload and a 404 `upload_not_found` recreates it; a pause (3xx/404/409/...) is announced to the owner once from the connection timer; `onCloseWidget` releases the timer and reader lease when the document close could not finish its page (`onResume`'s early return only leaves the instance suspended with the timer stopped, so it holds nothing). Still open: a killed reader leaves the session open; one packet per request. Extra I1 items from the reviewer: luasec default `verify`, redirect and total-timeout behavior of the socket layer, `PosUpdate` never firing in page mode, `CloseDocument`/`CloseWidget` order and exit paths, zoneinfo presence.

## Known open defects (not fixed)

Raised by the upstream source check:

- **Fixed after the upstream check: scheduled errors can no longer end the reader.** `UIManager` runs scheduled callbacks without `pcall`. In `koreader_runtime.lua` every call of the caller's callback now goes through a guarded `deliver`, and the whole scheduled hashing step runs under `pcall`; an unexpected error cancels the source and reports `source_unavailable`. Two tests cover a raising callback and an unexpected error inside a step, and fail on the previous code. Other scheduled entry points do not exist yet; P2 must follow the same rule.
- **Fixed as a documented limit: scroll mode.** Rolling documents in continuous scroll send `PosUpdate`, not `PageUpdate`. `Entry:onPosUpdate` now closes the page already shown and records one durable gap per scroll episode; nothing is credited from scrolling (supporting it needs a visible-range provider that cannot be verified without a device). Whether `PosUpdate` is also sent in other modes is unverified.
- **Accepted, to be measured in I1: native timing depends on handler order.** `koreader_reading.lua` needs `row[2] > 0` for the previous page, but the statistics plugin adds that duration inside its own `onPageUpdate`. If the plugin handles the event first, the duration is still 0 and the page falls back to unavailable timing. Entries also vanish from `page_stat` when the statistics plugin flushes (every 50 turns, on suspend and close), and durations under 5 s are never kept. Real native credit is therefore likely sparse.
- **`EndOfBook` semantics.** It fires on a forward turn past the end, and `ReaderStatus` may show its pop-up at the same time; a book that is only read to its last page does not emit it.
- **Fixed: `_meta.lua` no longer sets `name`.** The directory name decides, so installs must use `hackindle.koplugin` (stated in plugin-install.md).

Earlier items:

- Fixed: reset-path vocabulary snapshots with an unchanged filtered set are no longer queued again (`vocabulary_reset_last`, keyed by generation).
- The range ledger grows within a single day when reading with many gaps (touching ranges are already merged; only gaps keep entries). Accepted: it is bounded by pages per day and pruned to eight days.
- Statistics and vocabulary are still fully read on the UI thread when a refresh runs.
- Re-read cycles have no automatic signal; the owner starts one from the menu (**Start new read cycle**), and `book_finished` is emitted on `EndOfBook` or from the menu.
- `ffi.cdef` for `getrandom` runs on every UUID request, and no `/dev/urandom` fallback exists by design.
