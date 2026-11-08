# Testing and owner acceptance

Status: written 2026-11-09 by the coordinator as part of I1. It separates what unit tests prove from what only the owner can observe on real hardware. Nothing in the "owner-run" column has been performed; do not mark an item done until it was actually observed, and record what was seen in the [compatibility report](compatibility-report.md).

## 1. What the automated gate proves

`make check` (or `.local/harness-venv/Scripts/python.exe -B scripts/check.py`) runs unit tests only: no real database, service, container, browser or device. Last run on 2026-11-09: 36 Python, 35 contract, 160 server and 175 panel tests, Lua suite plus differential oracles; coverage gates of 80% each (server 97.45% lines / 87.61% branches / 93.01% functions, panel 100% / 95.58% / 98.51%, Lua 98.46% aggregate lines with every module >=80%).

| Evidence | Covers | Does not cover |
| --- | --- | --- |
| Contracts (`npm run test:contracts`) | schema acceptance/rejection, cross-field checks, canonical digests | any real client or server |
| Server (`npm run test:server`) | handlers, reports, grouping, backup/restore logic, uploads, static serving, with injected database | SQL on real PostgreSQL, concurrency, Node 24, proxy/TLS topology |
| Plugin (`tests/plugin/verify.py`) | capture, accounting, outbox, delivery, ack matching against synthetic KOReader inputs | KOReader internals, SQLite on the device, TLS, timing, battery |
| Panel (`npm run test:panel`) | view models, rendering, API usage with a fake API | `main.js` DOM glue, real layout, keyboard, screen readers, touch, real server data |

A PostgreSQL smoke test was run once (2026-11-07, throwaway container, owner approval); it is history, not a standing gate. A new real-database run needs the owner's explicit one-time approval and uses synthetic data only.

## 2. Owner-run acceptance checklist

Run in this order; each step builds on the previous one. "U" means unit evidence exists for the logic (not for the real behavior); "O" means only the owner can establish it. Use a test book set (synthetic or your own, kept out of Git), a spare or backed-up KOReader profile, and a throwaway or disposable server instance first.

### 2.0 Device items collected from the plugin install guide (do these first)

1. TLS: `ssl.https` verifies the server certificate on the Kindle build; which CA bundle is used. Until observed, treat the token as exposed on untrusted Wi-Fi. (O)
2. Redirect and total-timeout behavior of the socket layer (the plugin disables redirects and checks the total timeout in the response sink). (O)
3. `NetworkMgr:isConnected()` reports state without prompting or enabling Wi-Fi. (O)
4. Menu placement of **Kindle Sync** and that `getSettingsDir()` is the folder where `kindle_sync.conf` and `kindle-sync.sqlite3` live. (O)
5. Settings directory permissions and that SQLite state survives suspend and a forced restart. (O)
6. IANA time zone files exist at `zoneinfo_dir`. (O)
7. Whether `PosUpdate` ever fires in page mode (scroll mode is a recorded gap). (O)
8. `CloseDocument` arrives before `CloseWidget` and what happens on each exit path (close, switch book, sleep, power off). (O)
9. `ljsqlite3` read-only open and BLOB handling; `ffi/sha2` incremental hashing. (O)
10. How often page turns carry native seconds (measure from server data, not from the device). (O)
11. Blocking requests on the UI thread (up to 30 s) are tolerable; if not, a subprocess is needed. (O)
12. Battery cost of normal reading with the plugin versus without. (O)

### 2.1 Formats and identity

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 1 | Open one EPUB, one MOBI, one PDF with a text layer | each becomes its own source (SHA-256 identity), format shown | U logic, O device |
| 2 | Open the same file twice, restart KOReader between | same source, no duplicate | U, O |
| 3 | Open an image-only PDF | no volume credited, clear unavailable state, no fabricated zeros | U, O |

### 2.2 Grouping

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 4 | Same edition in two formats | offered as an uncertain match, nothing merged automatically | U |
| 5 | Confirm one match, merge two books, then split them again | source ids, notes and history unchanged; the emptied book page is gone, a split creates a new book id | U, O panel |
| 6 | Different translations of one work | stay separate books | U |

### 2.3 Reading, sessions, finish and cycles

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 7 | Read forward ~20 pages, close the book | a session with credited volume; active time from KOReader, or an explicit unavailable | U logic, O |
| 8 | Jump from page 10 to page 100 | nothing credited for the pages in between | U |
| 9 | Reread the same pages the same day | session with 0 new pages (re-read) but active time counted | U |
| 10 | Change font size or zoom, continue reading | no double credit, no crash, a layout change is not a viewed page | U logic, O |
| 11 | Sleep and wake the device mid-book | session ends at sleep; a new one starts at wake | U logic, O |
| 12 | Switch book without closing | session of the first book ends | U logic, O |
| 13 | **Mark book as finished**, then **Start new read cycle** | one finish per cycle; a reread is a new cycle and does not add a second unique book to the yearly goal | U |
| 14 | Read in continuous scroll mode | recorded as a gap, nothing credited (known limit) | U, O |

### 2.4 Dashboard

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 15 | Open the panel, sign in, view Overview | cards, chart and calendar match what you read; today uses the instance time zone; unavailable shows a dash, not 0 | U view models, O data |
| 16 | Switch 7/14/30 days, Volume/Time, year arrows | values change without a full reload; future days are not counted as missed | U |
| 17 | Hover a calendar cell and a chart point | tooltip with the full day text, grow-and-blur effect; on a touch screen a tap does the same | O (glue is not unit-covered) |
| 18 | Check layouts at 390 px and 1440 px, dark and light, keyboard only, and a screen reader | no horizontal page scroll, visible focus, tables available as alternatives | O |

### 2.5 Notes and context

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 19 | Create a highlight with a note on the device, sync | note appears with quote, note text and context (current page plus one before and after); context origin "creation" | U logic, O |
| 20 | Highlight on the first and the last page | the missing neighbour is shown as document start/end, not invented | U, O |
| 21 | Highlight across two pages; one on a blank page | all selected pages shown; blank page labelled | U, O |
| 22 | Edit only the note, then change the selection | context kept on a note edit; recaptured on a selection change | U logic, O |
| 23 | Import existing notes in a book that had notes before the plugin | imported; later context is labelled backfill | U, O |
| 24 | Same quote in an EPUB and a PDF | two annotations with separate notes and context | U |
| 25 | Long Russian text and HTML-like quotes (`<b>`, `&`) | shown literally, no markup injected | U |

### 2.6 Archive

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 26 | Delete a highlight on the device, sync | it moves to Archived with note and context; active and archived counts correct | U logic, O |
| 27 | Remove the book file or clear KOReader statistics | service history stays | U, O |

### 2.7 Retry, restart and delivery

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 28 | Read with Wi-Fi off, then enable Wi-Fi | queue kept on disk; sends within the next tick or **Sync now**; Wi-Fi is never switched on by the plugin | U logic, O |
| 29 | Kill KOReader mid-session, restart | a gap is recorded, no double credit, queue intact | U logic, O |
| 30 | Make the server unreachable, then wrong token, wrong URL, redirect | retry 5/15/60/300 s, one message per pause reason, nothing sent to another instance | U, O |
| 31 | Force a packet over 1 MiB (large annotation import) and drop the connection halfway | chunked upload resumes; no second upload opened; applied once | U logic, O |
| 32 | Repeat a commit, resend a packet after a lost answer | `duplicate` acknowledgement; totals unchanged | U |
| 33 | Server restored from an older backup | known gap: unchanged vocabulary/legacy snapshots are not re-sent; check what the panel shows | O |

### 2.8 Reset, source switch, backup

| # | Step | Expected | Evidence |
| --- | --- | --- | --- |
| 34 | Read the same book in EPUB, then PDF (source switch) | separate progress histories, no interpolation; the card follows the most recent source | U |
| 35 | Owner reset in the panel (type `reset`) | service data cleared, generation increases; plugin stops capture with `reset_unsupported` and its old queue is discarded as obsolete; no resurrection of old notes | U logic, O |
| 36 | Raw native reset: clear KOReader statistics only | service history unchanged; legacy archive keeps its high-water | U logic, O |
| 37 | Export a backup and import it into a second empty database | identities and totals preserved; no credentials in the file; a fresh device token must be created | U logic, O (real PostgreSQL) |
| 38 | Create the first device token before any device is linked, then rotate it, then unbind | first token works; rotation invalidates the old one; unbind lets a replacement bind | U, O |

## 3. Panel against a real server (not yet done)

The panel has only been viewed against throwaway stubs with synthetic data. Before trusting it: run migrations and owner bootstrap on a disposable PostgreSQL (needs approval), start `npm start`, sign in, and compare each page with the API responses. Record any mismatch between a real response and the contract as a defect in the report.

## 4. Rules for the report

Record the KOReader version, device model, plugin commit, server commit and database version. Record only what you saw: actual delays, sizes, responsiveness, comparative battery cost. Leave a cell empty rather than guessing. Hardware acceptance stays open until the report exists; this file and the unit gates never establish it.
