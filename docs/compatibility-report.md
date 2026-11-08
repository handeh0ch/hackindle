# Compatibility report (template)

Status: **empty template**. Nothing here has been observed. Fill a cell only with what you actually saw on your device and server; leave it empty otherwise. Do not paste tokens, URLs of your instance, book content or notes: describe them ("a 300-page EPUB") instead. Copy this file to a private location outside the repository if the report contains anything personal. The checklist and item numbers are in [testing.md](testing.md).

## Environment

| Item | Value |
| --- | --- |
| Date of the run | |
| Device model and firmware | |
| KOReader version (and how it was installed) | |
| Plugin commit / archive date | |
| Server commit | |
| Node.js and PostgreSQL versions | |
| Hosting (standalone / container / Vercel + Neon) and TLS termination | |
| Reporting time zone and page characters | |
| Network used (home Wi-Fi, hotspot, none) | |

## Device items (testing.md 2.0)

| # | Item | Observed result | Delay / size / measurement | Date | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | TLS certificate verification and CA bundle | | | | |
| 2 | Redirect and total-timeout behavior | | | | |
| 3 | `isConnected()` side effects | | | | |
| 4 | Menu placement, settings directory | | | | |
| 5 | Settings permissions, state survives suspend and forced restart | | | | |
| 6 | Time zone files present | | | | |
| 7 | `PosUpdate` in page mode | | | | |
| 8 | `CloseDocument` / `CloseWidget` order and exit paths | | | | |
| 9 | `ljsqlite3` read-only and BLOB; `ffi/sha2` | | | | |
| 10 | Share of page turns with native seconds (from server data) | | | | |
| 11 | UI responsiveness during blocking requests (longest freeze) | | | | |
| 12 | Battery: with plugin / without plugin (same reading, same time) | | | | |

## Workflow checklist (testing.md 2.1 to 2.8)

Result: `pass`, `fail`, `partly`, or empty when not run. Put the evidence (what you saw) and any defect reference in the last column.

| # | Result | What was seen / deviation / defect |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |
| 13 | | |
| 14 | | |
| 15 | | |
| 16 | | |
| 17 | | |
| 18 | | |
| 19 | | |
| 20 | | |
| 21 | | |
| 22 | | |
| 23 | | |
| 24 | | |
| 25 | | |
| 26 | | |
| 27 | | |
| 28 | | |
| 29 | | |
| 30 | | |
| 31 | | |
| 32 | | |
| 33 | | |
| 34 | | |
| 35 | | |
| 36 | | |
| 37 | | |
| 38 | | |

## Panel against a real server (testing.md 3)

| Page | Matches the API response? | Mismatch (endpoint, field) |
| --- | --- | --- |
| Overview (cards, chart, calendar) | | |
| Library | | |
| Book page | | |
| Notes and note detail | | |
| Connection | | |

## Defects and follow-ups

| Defect | Where | Severity | Status |
| --- | --- | --- | --- |
| | | | |

## Conclusion

Hardware acceptance: open / accepted with exceptions / accepted. State only what the table above supports.
