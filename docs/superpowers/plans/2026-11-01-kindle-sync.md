# Kindle Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a publicly distributable, self-hosted KOReader service with the full functionality of all four screens and preserved note context.

**Architecture:** The Lua plugin maintains its own durable queue and history on the device. One Express API receives data and serves the static dashboard; persistent state is stored in standard PostgreSQL. Vercel + Neon is the primary managed option; standard Node.js/container + PostgreSQL is a required second way to run the same application.

**Tech Stack:** Node.js 24.x, Express 5, JavaScript ES modules, `pg`, `ajv`, `ajv-formats`; the Vercel platform SDK is confined to the adapter. HTML/CSS/JavaScript/SVG, KOReader Lua/LuaJIT. Verification: node:test, Playwright as a dev dependency, a Lua assertion runner, real PostgreSQL and a Kindle. Compatible library versions are pinned in the lockfile after checking current documentation.

**Spec:** [Product requirements](../../requirements.md), [data contract](../../kindle-sync-data-spec.md), [configuration and publication](../../configuration.md), [hosting research](../../kindle-sync-hosting-research.md).

**Status:** APPROVED by the user on 2026-11-02. Development and local verification have started; external publication/deployment require a separate instruction. Interview answers are included; the previous split between a reduced first release and future sessions/goals has been canceled.

## Global Constraints

- The first release includes the overview, calendar, library, book view with percentage history/sessions, goals, cycles, Vocabulary Builder, quotes/context/archive, format grouping and connection setup.
- Formats: EPUB, MOBI and PDF with a text layer; AZW3 is excluded. Scans require prior OCR outside the service.
- By default, 2000 characters including spaces = one conditional page; exact character counts are stored. Font changes do not recalculate history.
- A repeated passage is credited once per day within a file; another format may credit it again. Rereading on another day counts again.
- Sessions show new volume for the day, including 0 when rereading, and all active time under KOReader's native rules.
- Context includes the pages containing the selection and one adjacent page on each side; PDF uses original pages. Later extraction is backfill; an error does not delay the note.
- Deleted highlights are archived; primary lists/counters show active items. Resetting KOReader does not delete server history.
- source_id is the file's SHA-256; book_id is a separate identity for a grouped book. Translations/editions remain separate. The owner confirms uncertain groupings; merge/split are reversible.
- The card shows progress from the most recently opened format; source histories/positions and identical quotes remain separate.
- Finishing a book and starting a new cycle are explicit actions on the Kindle. The annual goal counts unique grouped books. Words are unique saved Vocabulary Builder entries.
- Old native pages form a separate approximate archive; they are not added to the new series. Timestamps are UTC, days follow a configurable IANA zone, and intervals are split at midnight.
- Instance-specific settings and secrets stay outside Git. The public template uses timezone=UTC and empty secrets; the owner's personal profile stays in an ignored .env.
- Configuration is loaded/validated once and passed to modules. The frontend uses relative API URLs; the plugin uses the owner's URL/token. There are no embedded credentials, domains or mandatory cloud-provider accounts.
- Initially, one owner and one KOReader per instance. The device bearer is separate from the owner session; TLS, CSRF/Origin protection and the absence of secrets/reading content in logs are mandatory.
- Progress is sent at most once/minute; history packets are sent every five active minutes and at lifecycle boundaries. The queue survives crashes; retries do not enable Wi-Fi or wake the device.
- Development must not activate paid plans automatically. Publication/deployment remain a separate final operation after verifiable preparation.

## Review Focus

1. PDF zoom/reflow, font changes and rereading must not silently inflate new volume. P0 prototype and P1 tests.
2. A crash between saving a note, crediting characters and receiving an ack must not lose data or credit it twice. P2/B2/I1.
3. Merge/split, identical quotes and different formats must not reassign context/position to another source. B3/F2/I1.
4. Native reset, late packets and owner reset must not lose history or resurrect explicitly deleted data. C0/B2/P2/I1.
5. A different server/domain/PostgreSQL/timezone and a public repository must not require source edits or expose private config. B1/I2.

## Team, ownership and Git

Three implementers: **model `gpt-6.1-terra`, reasoning_effort `high`, fork_turns `none`**. Do not change the model silently. Include the absolute workdir, AGENTS.md, this plan, requirements, configuration, contract and base commit in each assignment.

| Implementer | File ownership |
| --- | --- |
| Backend | `server/`, `db/`, `scripts/`, `tests/server/`, root package/lockfile after C0, `index.js`, `dev.js`, `Dockerfile`, `compose.example.yaml` |
| Plugin | `plugin/`, `tests/plugin/` |
| Panel | `public/`, `tests/panel/` |
| Coordinator | `contracts/`, `docs/`, `tests/contracts/`, `tests/e2e/`, `.github/`, review/integration; initial package/lockfile in C0 |

The coordinator prepares separate worktrees/branches `.worktrees/backend`, `.worktrees/plugin`, `.worktrees/panel`; each implementer always specifies their own workdir. The plugin implementer builds the first technical prototype. After P0, the coordinator freezes C0 and updates the shared base; the three workstreams then proceed in parallel. The frontend uses contract HTTP fixtures without waiting for a completed API.

All contract/shared-dependency changes go through the coordinator. After C0, the backend owns package/lockfile changes; the frontend does not create a competing lockfile. The coordinator integrates verified commits into main sequentially. Do not run parallel git add/commit operations in one checkout; do not rewrite authorship, create a remote or push without an instruction.

Key files and responsibilities:

```text
server/config.js                    validated instance settings
server/app.js                       createApp({db,config}), no listener
server/db.js                        standard pg + transaction on one client
server/auth.js                      owner sessions / scoped device credentials
server/sync.js                      packet validation, dedup, section versions
server/uploads.js                   durable chunks + atomic commit
server/queries.js                   reading reports / note search
server/books.js                     group, split, matches, goals
server/content.js                   versioned paged text and private covers
server/start.js                     standalone entry
server/adapters/vercel.js            optional platform lifecycle integration
db/migrations/*.sql                 standard PostgreSQL schema
scripts/{migrate,setup-owner,export,import}.js
plugin/kindle-sync.koplugin/{main,_meta,adapter,state,context,reading,outbox,transport,vocabulary}.lua
public/{index.html,styles.css}
public/js/{api,app,overview,books,book,annotations,connection,charts}.js
```

Do not create empty files just to fill the list. Keep functions with a shared responsibility together; add modules only when a concrete need arises.

## Task 1: P0 — Compatibility and stable measurement prototype

**Owner:** plugin. **Files:** `plugin/COMPATIBILITY.md`, `tests/plugin/fixtures/`, `tests/plugin/prototype/`. **Consumes:** the actual KOReader version and synthetic EPUB/MOBI/PDF files. **Produces:** verified hooks/API, locator formats, native timing provenance and sample data for C0.

- [ ] Identify the installed version; inspect its source and available libraries. Investigate hook ordering: annotation save/edit, native-stat flush, rerender, close/suspend/resume, background requests and SHA-256. Do not treat master as device verification.
- [ ] Write failing checks first: the same text after a font change has unchanged volume; a same-day repeat=0 new characters; a jump does not count the skipped interval. The prototype unions viewed-text intervals within source/day; it records the whitespace/Unicode rule and measurement version.
- [ ] For PDF, map native text boxes to the visible area: crop/zoom, rotation, scrolling, reflow, columns and partially visible words. Separately obtain text from original pages N−1/N/N+1 for context. Do not substitute a full page for the visible area in statistics.
- [ ] Confirm native active intervals and a way to remember already credited slices without an independent timer. Check the installed version's min/max settings, midnight and multiple flushes of one stationary page.
- [ ] Verify stable UUIDs/context after restart and editing, restoration of the engine selection, end-of-book handling, pending/backfill and background requests without prolonged UI blocking.
- [ ] Record results and measurements. If stable volume/timing/PDF behavior is unconfirmed, present the concrete blocker and options to the user before building the main API; do not silently reduce agreed requirements.
- [ ] Commit `test(plugin): establish verified reading and context primitives`.

## Task 2: C0 — Freeze the contract and tools for three implementers

**Owner:** coordinator. **Files:** `contracts/{sync,uploads,events,read-api}.schema.json`, `contracts/examples/`, `tests/contracts/schema.test.js`, `docs/api-v1.md`, initial package/lockfile. **Consumes:** P0 and data-spec. **Produces:** precise payload/ack/error/read schemas and a shared commit.

- [ ] Freeze sync/config, sync, chunk upload, source covers, vocabulary/legacy packets and all owner routes. Precisely describe typed locators, sealed reading events, section versions and configuration-handshake fields.
- [ ] Describe packet/event idempotence keys, the semantic JSON hash, independent snapshot-section versions and exact ack keys. For owner reset, define tombstones/reset barrier and acknowledged client statuses: replaying the old queue must not resurrect data, while new observations remain valid.
- [ ] Define the read API: books/source switch, daily/summary statistics, sessions/cycles, goals, vocabulary, active/archive annotations, group/split/match actions and device setup. Lists use a cursor + byte budget; previews are up to 500 characters; full content is delivered in version-bound chunks <=256 KiB. Daily series are <=366 days; all-time summaries have no unbounded days array.
- [ ] Manifest/chunks: direct JSON <=1 MiB, envelope <=16 MiB, raw chunks <=1 MiB, TTL seven days, at most two open uploads/device. Repeating a chunk/commit is safe, UTF-8 is decoded after assembly, and a 410 resumes with a new upload_id and the old envelope/seq.
- [ ] Create synthetic fixtures only: multiple formats of one book, another translation, ambiguous metadata, identical quotes, source switch, rereading with zero volume, pending/backfill, archive, legacy, vocabulary unavailable, leap day and different IANA zones/DST. Generate large data from small templates; do not commit real books.
- [ ] Create the initial package with runtime dependencies and a Playwright dev dependency, a lockfile and scripts `test:contracts`, `test:server`, `test:panel`, `test:e2e`. Tests use node:test and Playwright configs in their respective tests directories. Each implementer runs npm ci in their own worktree.
- [ ] First observe `npm run test:contracts` failures, then PASS on valid fixtures and expected rejections for invalid dates/seq/locators/kind/timezone. Also enforce ID uniqueness and cross-field checks in backend validator tests.
- [ ] Commit `chore: freeze portable sync contracts and test fixtures`; share the SHA with all three implementers. After this, schema changes require a shared checkpoint.

## Task 3: B1 — Portable configuration, PostgreSQL and authentication/authorization

**Owner:** backend. **Files:** config/app/db/auth/start, Vercel adapter/entry, migrations, setup-owner/migrate, `.env.example`, Docker/compose, `tests/server/{config,auth,portability}.test.js`. **Interfaces:** `loadConfig(env) -> Config`; `createApp({db,config}) -> Express.Application`; `db.withTransaction(callback) -> Promise<result>`.

- [ ] Write failing tests: missing DATABASE_URL, invalid origin/timezone/port/proxy; messages include the setting name but not the secret value. If the initialized policy differs from env, fail explicitly without reprojecting history.
- [ ] Write auth tests: anonymous read=401, device token on owner read=403, another device_id=403; only one binding when two UUIDs race; rotation revokes the old token. Sessions survive createApp/restart, logout revokes them, and mutations without CSRF/with another Origin are rejected.
- [ ] Implement a standard PostgreSQL schema: instance/device/owner/session, sources/book groups/memberships, annotation versions/archive, immutable events, snapshot versions, vocabulary, upload manifests/chunks, goals and reset barriers. Verify keys/transactions against a real test PostgreSQL instance.
- [ ] Use one config module and dependency injection; frontend relative URLs; no Neon API requirement at runtime. Vercel imports stay in the adapter; standalone does not load the Vercel SDK. Each pg transaction uses one client; connections are released.
- [ ] Add private owner bootstrap: salted scrypt, random hashed device/session secrets, session TTL 14 days, HttpOnly/SameSite cookie/Secure over HTTPS. Throttle login after five failures in 15 minutes per username+IP using the shared DB; no default owner/password.
- [ ] Add dev/start/migrate/setup commands and a container example. Secrets are injected externally; explicit COPY and .dockerignore exclude env/data. Verify the same application with two different DB URLs/origins/timezones without source edits.
- [ ] `npm run test:server` against standard PostgreSQL — PASS. Commit `feat(server): add portable PostgreSQL application and auth`.

## Task 4: B2 — Ingestion, history, archive and large data

**Owner:** backend. **Files:** sync/uploads/content, `tests/server/{sync,uploads,archive,reset}.test.js`. **Consumes:** C0/B1. **Produces:** an atomic packet/event API, persisted history and versioned content.

- [ ] Write tests: a duplicate packet/event adds no volume/seconds; different JSON under the same ID=409; key order causes no conflict; an old snapshot does not override a new one; older independent progress is not lost after newer annotations. Verify concurrent first insert/update for one source.
- [ ] Verify that full annotations=[] archives items, while an omitted section/source error does not. The archive contains text/note/context; identical quotes from another source are unaffected. Native reset does not clear the ledger. Owner reset + an old queue must not resurrect deleted data.
- [ ] Implement validation, packet/event dedup and section versions in transactions, with COMMIT before ack. Do not store upload progress in function memory/local files.
- [ ] Upload tests: interruption/restart/repeated commit; invalid hash/size/identity; a different chunk at the same index; UTF-8 across chunk boundaries; TTL=410; open-upload/byte limits exceeded. A partial set does not replace live annotations.
- [ ] Implement private JPEG/WebP covers <=64 KiB and content cursors: long text is fully reconstructed from chunks, a version change returns 409 content_changed, and user HTML remains text.
- [ ] Relevant server tests — PASS with real PostgreSQL. Commit `feat(server): persist idempotent reading history and annotation archive`.

## Task 5: B3 — All reports, grouping and backup/restore

**Owner:** backend. **Files:** queries/books, export/import scripts, `tests/server/{reports,grouping,backup}.test.js`. **Consumes:** B2/C0. **Produces:** owner read/mutation API for all four screens.

- [ ] Write exact fixture assertions: 4000 chars=2 pages; rerender does not change the past; repeating one source=0 new characters, another source may credit them again; a rereading session has time and 0 new volume; UTC-midnight splitting across different reporting zones; leap day and zero-activity days.
- [ ] Verify daily/month/year/all-time, current streak, averages over elapsed calendar days, daily record, bounded calendar and totals-only query. Legacy data stays separate; vocabulary unavailable does not clear the previous successful snapshot.
- [ ] Merge/split tests preserve source annotations/positions/events and original IDs; an ambiguous match requires owner action; translations stay separate. The annual goal counts grouped unique books; a repeat cycle adds no new unique book; the card uses the source's latest opening, not its latest network arrival.
- [ ] Implement parameterized SQL, indexes, pagination/search and owner mutations. Do not connect percentage series from different sources with a line or reconstruct missing historical percentages.
- [ ] Add data/cover export/import without credentials. Import is allowed only into empty data tables; it restores IDs/versions/policy and requires a new private credential bootstrap. A round-trip to another PostgreSQL instance preserves text, counts and totals; a nonempty target remains unchanged.
- [ ] Relevant server tests — PASS. Commit `feat(server): add grouped reading reports goals and restore`.

## Task 6: P1 — Reading accounting, annotations, context and vocabulary

**Owner:** plugin. **Files:** adapter/state/context/reading/vocabulary, `tests/plugin/run.lua`, `tests/plugin/{reading,context,vocabulary}_test.lua`. **Consumes:** P0/C0. **Produces:** source captures, sealed events and successful snapshots.

- [ ] Write Lua assertions against P0 fixtures: visible-range union, jump/zoom/rerender, same-day/new-day reread, UTF-8 characters, source-specific identity and consistent data provenance independent of grouping. Run `luajit tests/plugin/run.lua` and observe failures before the production implementation.
- [ ] Implement a separate SQLite database: annotation UUID/context, credited ranges, source IDs, sessions/cycles, native credited slices and immutable events. State advance/event/outbox must share one transaction boundary; the native DB remains unchanged.
- [ ] Count active time through the verified native adapter, without a new timer. On reset/native DB unavailable, previously accumulated data remains; the same interval is not credited twice after flush/restart. Report timezone/denominator come from the authenticated sync profile and are not hardcoded.
- [ ] Context tests: first/last page, multipage, chapter/footnote/blank, original PDF neighbors, note/range edits and identical quotes in two formats. Preserve selection/position and do not generate page turns; late context=backfill, and failure does not lose the note.
- [ ] Export saved vocabulary and the legacy archive separately. Do not present a disabled/unavailable source as an empty successful set. Extract/resize the thumbnail locally; do not send the book file.
- [ ] Lua tests — PASS; hardware results are confirmed in I1. Commit `feat(plugin): capture stable reading history notes and vocabulary`.

## Task 7: P2 — Queue, protocol and device settings

**Owner:** plugin. **Files:** outbox/transport/main/_meta, `tests/plugin/{outbox,transport}_test.lua`, plugin install guide. **Consumes:** P1/C0. **Produces:** a plugin distribution without local settings/state.

- [ ] Write crash tests for native note/state/queue/ack boundaries. After restart, an undelivered note is discovered; previously credited chars/time are not credited again; a lost ack causes a retry with the original bytes/seq. Do not remove a record after a malformed 200/another instance/source/incomplete result keys.
- [ ] Implement one request at a time, verified TLS, a bounded timeout and the background mechanism verified in P0. Direct/chunk upload uses persisted UTF-8 bytes; a new upload_id after 410 does not change envelope/seq. Oversized data is retained with an explicit error.
- [ ] Verify retries 5/15/60/300, Retry-After, pause on 401 and actionable errors 400/403/409/413. Wi-Fi off/suspend must not start network activity; the queue remains on disk.
- [ ] URL/token settings are private KOReader settings. Fetching the profile checks instance/policy; changing servers must not silently send the queue to the wrong instance. Add sync now/status, queue length, last success/error and explicit finish/restart cycle actions.
- [ ] Sample progress once/minute plus at boundaries; seal reading batches every five active minutes plus lifecycle flush. Newly collected text/context is not resent with every minute's progress.
- [ ] Lua tests — PASS; build the archive from a source allowlist and verify the absence of private config/state/books. Commit `feat(plugin): deliver durable portable sync client`.

## Task 8: F1 — Overview, calendar and library

**Owner:** panel. **Files:** public shell/api/app/overview/books/charts, `tests/panel/{playwright.config,mock-server,overview.spec}.js`. **Consumes:** C0 HTTP fixtures. **Produces:** #/overview and #/books without depending on a completed backend.

- [ ] Write failing Playwright cases: login/401, loading/empty/error/retry, selected period, 7/14/30-day chart, year/leap day, volume/time heatmap, streak/goal/vocabulary and no fake zeros for unavailable data.
- [ ] Implement all agreed cards, the year grid and grouped-book library, covers/fallback and last-source progress. Preserve exact values and round only interface text; conditional pages are explicitly labeled.
- [ ] Use relative API URLs and a test-only mock server. Private env stays outside public/**; HTML/JS contains no owner instance URL/credentials.
- [ ] Verify keyboard/accessibility, a tabular alternative to the chart and 390/1440 px layouts. `npm run test:panel` — PASS. Commit `feat(panel): add complete reading overview and grouped library`.

## Task 9: F2 — Book, sessions, notes and instance management

**Owner:** panel. **Files:** book/annotations/connection modules, `tests/panel/{book,annotations,grouping,connection}.spec.js`. **Consumes:** C0/F1. **Produces:** source switch/history, session/cycle views, note/archive/search, grouping/goals/device setup.

- [ ] Write cases: separate percentage histories/source switch; sessions with 0 new volume; explicit cycles and yearly goal; the same quote in EPUB/PDF has separate note/context; search/book/note/archive filters and correct active/archive counts.
- [ ] Implement full context through detail/content paging with restart on version changes; distinguish pending/unavailable/backfill, and do not invent neighboring pages beyond book boundaries. Display long Russian text and HTML-like quotes safely.
- [ ] Add uncertain-match confirmation and reversible merge/split; do not hide data format/provenance. Owner goal/device/reset actions use CSRF and clear confirmation of consequences. Reset follows the C0 barrier rather than a simple DELETE followed by resurrection.
- [ ] Connection view: owner-controlled URL/token rotation, one-time display of a new secret and last sync. The server must not pretend to know the Kindle's local queue length without separate telemetry.
- [ ] Panel tests — PASS at 390/1440 px and with keyboard navigation. Commit `feat(panel): add source history sessions archive and grouping`.

## Task 10: I1 — Integration and hardware acceptance

**Owner:** coordinator; fixes go back to the respective implementer. **Files:** `tests/e2e/`, `docs/testing.md`, compatibility report.

- [ ] After review, integrate completed commits into main sequentially; check the actual diff/ownership. Run contracts/server/Lua/panel tests, then `npm run test:e2e` against the real application and a separate PostgreSQL instance, without HTTP mocks.
- [ ] End-to-end scenario: multiple formats → grouping → reading/session/finish/cycle → daily/annual dashboard → notes/context → archive → retry/restart. Verify reset barriers, source switch, partial upload with a logical payload >4.5 MB and repeated commit without double counting.
- [ ] Verify owner export/import into another DB; raw native reset does not reduce service history. Fixtures and reports contain no real books/notes/credentials.
- [ ] On real KOReader, repeat the P0 edge cases, offline/crash/sleep/reconnect, font/zoom changes, words/covers, unsupported data and Wi-Fi off. Record the version, actual delays, sizes, responsiveness and comparative battery cost.
- [ ] If device access is unavailable, hardware acceptance remains open. Do not claim a complete release based only on mocks. Commit `test: verify complete cross-component reading workflow`.

## Task 11: I2 — Public repository and two reproducible deployment paths

**Owner:** coordinator + backend. **Files:** README, deployment/backup guides, Docker/compose, `.github/workflows/`; secret values remain outside Git.

- [ ] Check `git check-ignore` for root/nested env, plugin state, keys/dumps/books/exports and the trackability of empty .env.example/migrations. Add a redacted staged check and full-history secret scanner to CI/release; fetch the full history, not just the latest commit. Pin the specific scanner/version/action based on an official source.
- [ ] Inspect the image/plugin archive: populated env, local config, DB dumps, notes and device tokens are absent. Logs/config errors contain setting names but no credential values. Scan failures stop publication.
- [ ] Document install/migrate/bootstrap/start and backup/restore commands for standard Node.js/PostgreSQL and the container. Deploy a test instance with another origin/timezone and standard PostgreSQL without source edits; verify owner/device separation and HTTPS through the selected reverse proxy.
- [ ] Prepare the Vercel/Neon Free guide/env; verify the adapter, pooling/TLS and migrations. Project identifiers and credentials belong to the operator, not the repository template.
- [ ] After owner permission and access are available, deploy the prepared instance and verify Kindle HTTPS/cold start/retry and quotas. Paid options are not activated. Remote/push/publication require a separate instruction and must preserve the selected authorship.
- [ ] Commit `docs: verify portable deployment and public release checks` with actual results, not secrets.

## Completion criteria and review

All tasks belong to one first release; task order is development order, not a deferral of agreed features to an indefinite second phase. Completion requires P0/C0, the three deliverables, integration/hardware verification and reproducible ways to run the application. Cloud publication separately requires access and permission.

User approval authorizes implementation and local verification. Hardware results, cloud deployment and publication are not complete until actually confirmed.
