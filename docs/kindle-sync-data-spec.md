# Kindle Sync: data contract draft

Status: revised after the design interview. This replaces the initial EPUB-only, native-page snapshot proposal. Product rules are in [requirements.md](requirements.md), deployment rules in [configuration.md](configuration.md). C0 specifies the wire contract in [API v1](api-v1.md) and executable [schemas](../contracts/) using available compatibility findings; the owner deferred further device observations until the assembled application is ready. Unverified adapter behavior remains explicit and does not certify a working plugin.

## Identity and ownership

| Identifier | Meaning |
| --- | --- |
| instance_id | UUID of one initialized installation; independent of hostname or hosting vendor |
| device_id | Persistent UUID of the plugin installation; loss of local state creates a new identity, not a reset seq under the old identity |
| source_id | SHA-256 of the exact EPUB/MOBI/PDF file, 64 lowercase hex characters |
| book_id | Server UUID for a user-facing book/edition grouping one or more source files |
| annotation_id | Persistent plugin UUID for one annotation within its source |
| event_id | UUID of an immutable reading/history event |
| session_id / cycle_id | Stable device identifiers referenced by related history events |
| seq | Monotonic device outbox sequence, integer 1..2^53−1 |

Do not use title, array index, a native partial MD5 or a text quote as an identity. The same file renamed has the same source_id; changed file bytes have a new source_id. Grouping does not rewrite source-specific locations or events. Manual merge/split changes group membership and preserves all source data. Different translations/revisions remain separate unless the owner explicitly corrects the grouping.

## Configuration and time

Use authenticated `GET /api/v1/sync/config` to obtain instance_id, protocol version, reporting timezone, conditional-page denominator and transport limits. A device token can read this nonsecret profile and write sync data; it cannot read the owner's library.

Persist the reporting policy at first initialization. It comes from installation settings, not a built-in owner timezone. Save instants in UTC. The plugin and server use the same IANA timezone to split credited active intervals at local midnight; weeks start Monday. A later configuration mismatch must not silently reproject historical totals.

The native annotation's local timestamp is preserved as reported. Do not invent a UTC offset if its timezone is unknown; keep server received_at separately. Dates of reading events come from their UTC instants and the initialized reporting policy.

## Source metadata and positions

Metadata includes format (`epub`, `mobi`, `pdf`), title, authors, optional language and available identifiers, including identifier provenance. These values are matching evidence, not proof that files contain the same edition. Reliable mappings may group automatically; uncertain candidates require owner confirmation.

Locations are typed per document engine: rolling text uses native XPointers; PDF uses original page numbers and selection geometry/order as required by the verified adapter. They are not interchangeable and are not advertised as EPUB CFI. Progress samples include fraction, source position, timestamp and session_id. The panel shows the most recently opened source and keeps per-source history separate.

Full book files are not uploaded. A pre-reduced JPEG/WebP cover up to 65,536 bytes may be uploaded to a source-specific endpoint and stored in PostgreSQL; the book card selects an available member cover. No local persistent upload directory or provider-specific object store is required.

## Durable device data

The plugin owns a separate SQLite state database outside the shipped plugin directory. Store annotation identities/context, source mappings, credited text ranges, reading history, seq and outbox there. A transaction persists the state advance and its outgoing payload together. Never modify the native statistics DB to implement service bookkeeping.

1. Capture viewed text ranges qualified by the verified native reading-time behavior. Union overlapping ranges per source/reporting day, so font changes and same-day rereads do not credit the same passage twice. For PDF, use visible text regions; a zoomed crop must not automatically credit a full physical page.
2. Preserve exact credited character counts, using one versioned extraction/whitespace rule verified by the prototype. Derive conditional pages from the initialized denominator, default 2000. Historical credited amounts are not recomputed when font/layout changes.
3. Archive the native active-time contribution and its provenance. Native timestamps/durations are an estimate, not necessarily exact continuous wall-clock intervals: native pause handling can shift a placeholder start, and long dwell is capped. Observe page/lifecycle pause-resume windows to allocate the native credit across reporting days; these are chronology observations, not a second attention timer. Clearing native statistics does not delete already credited service records.
4. Seal reading records into immutable events with persistent event_id. Active records can be checkpointed locally; publish only stable slices, not repeatedly add the same native duration. Crash/restart reconciliation must not manufacture time or lose already queued data.
5. Session new volume is the newly credited amount for that day, including zero on rereading; active time includes rereading. Close a session on sleep, close or source switch.

Exact hook ordering, range extraction, native interval identity and PDF viewport handling require hardware evidence during final owner-run acceptance. Contract and application development may proceed before that evidence, using explicit adapter assumptions. Unsupported extraction must be visible, not replaced with fabricated page counts.

## Synchronization envelopes

`POST /api/v1/sync`, JSON, `Authorization: Bearer <device-token>`.

```json
{
  "schema_version": 1,
  "instance_id": "48bc0344-efad-4c68-adb6-dc0f0ba57276",
  "device_id": "a92e58b4-851b-467b-a5ad-1eaaccc84c61",
  "reset_generation": 0,
  "seq": 42,
  "captured_at": "2026-11-01T10:00:00Z",
  "kind": "source_snapshot",
  "source_id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "payload": {
    "metadata": {"version": 1, "value": {"format": "epub", "title": "Synthetic book", "authors": ["Example Author"], "language": null, "identifiers": []}},
    "annotations": {"version": 1, "value": []}
  }
}
```

The example uses synthetic values. Packet kinds:

- `source_snapshot`: metadata and optional complete snapshots of annotations/current progress for one source. Omitted sections are unchanged. A successfully read empty annotations list archives active annotations of that source; an unavailable source is omitted, never sent as an empty list. An absent source file itself does not delete service data.
- `reading_events`: bounded batches of immutable events for one source. Event types: reading_segment, progress_sample, session_started, session_ended, cycle_started, book_finished. C0 defines event fields and explicit native provenance; the contract does not prove that an adapter can capture them on the device.
- `vocabulary_snapshot`: successfully read complete set of saved Vocabulary Builder entries; source_id is null. Preserve word/language/source metadata where available and count saved unique words, not dictionary lookup occurrences.
- `legacy_statistics`: native per-source approximate history clearly marked as legacy; never combine native screen-page counts with the new character-based series.

A reading_segment records event_id, source_id, session_id, native active_seconds, native-record provenance, timing basis/allocation quality, observed awake windows where available, and newly credited characters. The authoritative time amount is KOReader's credit, not the sum of wall-clock windows. When those windows are known, distribute credited seconds proportionally over their durations, splitting at reporting midnight and using deterministic remainder allocation so day totals equal native credit exactly. An uncapped contiguous interval needs no rescaling. If observation windows are unavailable, use an explicitly marked estimated native anchor; do not invent an exact ended_at. Freeze the applied allocation with the event instead of silently moving credited history later. The same event is credited once. Exact payload fields and native identity reconciliation remain C0 deliverables. Positions/range evidence stay source-specific; cross-format passage matching is deliberately excluded.

C0 uses `native_seconds` for native credit and an explicit `volume_date` for each event's newly credited characters; time allocation may span several reporting days. The proportional allocation floors each day's weighted credit, then assigns remaining seconds by descending fractional remainder, breaking ties by earlier date. The API describes the corresponding packet fields and provisional adapter provenance; implementing and validating the actual device capture is separate work.

For a first valid sync/upload manifest, bind an unbound device token to device_id atomically. A racing different UUID gets 403. Token rotation preserves binding and history. Reinstallation/replacement is an explicit migration operation; it must not automatically add a duplicate copy of old data.

## Ordering and acknowledgement

Server validation happens before writes. Apply one logical envelope in one PostgreSQL transaction and acknowledge only after COMMIT. Persist packet identity `(device_id, seq)` and canonical semantic JSON digest; identical retries return a safe acknowledgement, different content under the same seq returns 409 without partial writes.

For source snapshot sections, version independently by `(device_id, source_id, section)`: newer applies, equal identical is duplicate, older is stale. A later metadata/annotation snapshot must not discard older independently delivered progress. For immutable events, event_id is unique; equal content is a duplicate and changed content under the same ID is a conflict. Packet records and event uniqueness survive server restarts/concurrent requests.

Ack contains schema_version, instance_id, device_id, source_id, reset_generation, current_reset_generation, seq, kind and the result of each supplied section/event. Delete an outbox entry only after matching all identities, kind, seq, expected result keys and valid result values for that kind. A malformed 200 is not acknowledgement. Exact result schemas are in the C0 shared contract. Obsolete generations have an explicit discard acknowledgement; old queued payloads are never relabeled to the new generation. A durable client baseline prevents unchanged native content from reappearing after an owner reset.

## Transport and retry policy

- Direct JSON request limit: 1,048,576 bytes. Logical envelope limit: 16,777,216 bytes. Split event batches before that limit; an oversize single annotation snapshot is retained with an explicit error, never silently truncated.
- Large envelopes: `POST /api/v1/uploads` creates `{upload_id,instance_id,device_id,source_id,seq,kind,byte_length,sha256,chunk_count}`; `PUT /api/v1/uploads/{id}/chunks/{index}` accepts raw byte chunks up to 1 MiB, starting at index 0; `POST /api/v1/uploads/{id}/commit` assembles/checks bytes and applies the original envelope atomically.
- Keep chunks/manifest in PostgreSQL, not function memory/files. Decode UTF-8 after assembly, since a character can cross chunk boundaries. Repeated identical chunks/commit are safe; mismatched content gets 409. Partial upload never replaces live state.
- Upload TTL is seven days, at most two open uploads per device. Expiration returns 410; recreate upload_id using the same saved envelope/seq. Opportunistic cleanup suffices; correctness does not depend on cron.
- Annotation changes: enqueue durably immediately, send after a short debounce with a target of seconds on an already available connection. Progress samples: at most once/minute plus lifecycle boundaries; statistics/history batches: every five active minutes plus close/suspend checkpoint.
- One network request at a time. Retry transient failures after 5/15/60/300 seconds while active; honor 429 Retry-After. 401 pauses sending until credentials are corrected. 400/403/409/413 retain data with a visible actionable error. Do not wake the device or enable Wi-Fi for retry.
- HTTPS certificate validation and bounded network timeouts are required. Nonblocking behavior, battery cost and real delays need device tests.

## Annotations and context

Each annotation has stable annotation_id, source-specific locations, kind, quote/note text, optional chapter/native timestamps and context. Normal bookmarks without a selected passage use context=null. Display HTML/Markdown as text in the first release.

For a highlight, context contains status, origin, captured_at, layout/page basis, total pages at capture, before, selection_pages and after. Page entries contain page number and full extracted text. Capture P−1/P/P+1 for a one-page highlight; for a multipage selection include the whole range and one neighbour on either side. For PDF these are original document pages, independently of volume statistics.

- ready: complete available page texts, timestamp, page basis and no error. A missing first/last neighbour is null; an image-only blank text page can be an empty string.
- pending/unavailable: preserve/send the annotation with a reason; a failed extraction does not block the note. Pending survives restart and retries when the book is available.
- origin is creation or backfill. Late extraction/import is backfill, not a reconstruction of original page boundaries.

Editing note text preserves stored context; changing selection recaptures it. Font changes do not recapture old context. Extraction must restore the engine's selection/position and must not emit artificial page-turn/statistics events.

Missing IDs in a successful full annotation snapshot are archived, not destroyed. Reactivation with the same ID restores active status. Native errors, missing files and incomplete uploads cannot archive data. Identical quotes in different sources remain distinct; archived records retain quote/note/context. Owner service-data deletion is separate from native sync and must not trigger later silent resurrection.

## Read API and owner actions

Owner-only read routes: books, book details, per-source progress/history, daily statistics, sessions, cycles, vocabulary, active/archive annotations, annotation detail/content and device status. Server-side query schemas are frozen in C0; the panel uses the same synthetic contract fixtures as backend tests.

Lists use bounded cursor pagination. Return quote/note previews in lists and full text through paged detail/content routes, so one long context does not exceed hosting response limits. Bind content cursors to annotation version; a changed version requires restarting that content read.

Statistics sum character counts/active seconds for grouped books without cross-format deduplication. Current active annotation counts exclude archive. Day ranges are inclusive; totals-only queries support all time without returning an unbounded daily array. Calendar/day series are requested for bounded ranges including leap years. Empty days are explicit zeros and future days do not penalize streaks/averages.

Owner mutations include authentication, device-token rotation, grouping/ungrouping source files, confirming uncertain matches, annual goals and explicit service-data reset. Use cookie sessions with CSRF/Origin checks, independent of the device bearer token. Grouped-book completion/cycle queries derive from preserved source events; merge/split never deletes those events.

## Implementation acceptance

The updated plan must test: stable counts across reflow; source-specific dedup and allowed cross-format double count; PDF cropped views and original-page context; exact persisted queue after crash; duplicate events/uploads; independent snapshot section versions; annotation archive/backfill; native reset without history loss; grouping/splitting without lost source data; unique annual completion/cycles; Vocabulary Builder export; midnight/DST/host-timezone independence; secret-free examples/packages; and the same application against Neon and ordinary PostgreSQL.
