# P2 design proposal: durable sync client

Status: proposal for owner approval. It is not an approved plan, starts no work, and may only be implemented after P1 is independently reviewed and registered. It expands Task 7 of the [approved plan](superpowers/plans/2026-11-01-kindle-sync.md) and uses [api-v1.md](api-v1.md) for the server side, which needs no change.

## Goal and hard limits

Deliver the packets P1 already writes to the on-disk outbox, exactly once in effect, without losing or double-crediting data across crashes, lost acknowledgements, restarts and server changes. Never enable Wi-Fi; do nothing while offline; keep URL and token out of the distribution and out of logs; one request at a time; bounded timeouts; no device writes by agents (the owner installs and configures).

## Starting point

- `outbox (seq INTEGER PRIMARY KEY, packet BLOB)` holds sealed UTF-8 packets in sequence order. Nothing reads or deletes rows.
- P1 modules already validate acknowledgements for several kinds (`source.metadata_ack`, `source.reset_metadata_ack`, `legacy.ack`, `reset.vocabulary_ack`) and expose them through `app.lua` only when an injected `authenticated_ack` verifier accepts the exact bytes.
- `Entry:configure(config, deps)` is the single wiring point, and nothing calls it. The default entrypoint stays unconfigured.
- `GET /api/v1/sync/config` returns the profile; `POST /api/v1/sync`, `/uploads`, `/uploads/{id}/chunks/{n}`, `/uploads/{id}/commit` and the cover `PUT` are the device routes. `POST /api/v1/owner/device/unbind` exists for a replacement installation.

## Components

1. **Outbox reader** (`plugin/outbox.lua`): `peek()` returns the lowest `seq` and its bytes; `complete(seq)` deletes it. Strict order, one in flight, so a blocked head blocks later packets (acceptable, keeps server sequence semantics).
2. **Delivery state** (one small key `outbox_meta`): `{attempts, next_at, pause = {reason}, upload = {id, seq}}`. Written in the same transaction as any state change it describes. Time uses UTC with a monotonic guard (a clock that moves backwards never extends a wait beyond the schedule).
3. **Transport** (`plugin/transport.lua`, injected HTTP): builds the request from persisted bytes only, verifies TLS, sets timeouts, returns status, headers and body. No retry logic inside.
4. **Acknowledgement router**: validates the response against the packet (instance, device, source, generation, seq, kind, one result per section or event, status applied, duplicate or obsolete_discarded), calls the matching P1 hook, then `complete(seq)`. Hooks must be idempotent because a crash between hook and delete resends the packet and the server answers `duplicate`. This idempotence is the first thing to verify in tests.
5. **Scheduler**: runs only when the device already reports a connection and no suspend is in progress; never calls the network manager's enable path. Triggers: manual "Sync now", page-independent timer while the reader is open, and after close.
6. **Settings and profile**: URL and token live in KOReader's private settings directory (separate file from state, never logged). On first use fetch the profile, compare instance and policy with the saved one (`profile.accept`), then call `Entry:configure`. A different instance pauses and asks the owner; the queue is never sent to a server whose instance id differs.
7. **Menu**: sync now, status (queue length, last success, last error code), pause reason, finish book and start a new read cycle. The last two give `finish_book` and `begin_cycle` an owner-driven trigger, since no automatic signal for re-reads exists.
8. **Packaging**: extend `scripts/build-plugin.js` to emit a zip from the allowlist, with a test that no settings, state database or book files are included, plus an install guide.

## Delivery rules

| Outcome | Action |
| --- | --- |
| Network error, timeout, 5xx | keep packet; wait 5, 15, 60, then 300 s; honour `Retry-After` when larger |
| 429 | same backoff; `upload_limit` means finish an open upload first |
| 401 | pause with "token rejected"; resume only after new settings |
| 403 `instance_mismatch`, `device_mismatch` | pause; wrong server or the device needs `unbind`; never drop the packet |
| 400 any, 409 `packet_conflict`, `section_conflict`, `event_conflict`, `legacy_*` | pause with the code; packet kept; this is a client bug or protocol drift |
| 409 `future_generation`, ack `current_reset_generation` higher | refresh profile; P1 enters the baseline path; old packets then receive `obsolete_discarded` and are completed |
| 409 `unicode_version_*` | pause vocabulary kinds only |
| 413, or packet over 1,048,576 bytes | use the chunk upload (manifest, chunks of at most 1 MiB, commit); keep an oversized or rejected packet with an explicit error |
| 410 on an upload | create a new upload for the same bytes and seq; the envelope never changes |
| 200 with a malformed or mismatched ack | treat as failure; keep the packet; do not guess |

## Invariants to test (unit, with injected clock, transport and store)

1. A packet is deleted only after a validated ack for its exact seq and bytes.
2. A lost ack resends identical bytes; the server's `duplicate` completes it.
3. A crash at each boundary (before request, after response, after hook, after delete) leaves either a resend or a clean state, never a loss or a second credit.
4. Wi-Fi off, suspend or an unconfigured plugin start no network activity and keep the queue.
5. Pause states survive restart and clear only by their explicit condition.
6. Retry timing follows 5/15/60/300 s and `Retry-After`, with a backwards-moving clock handled.
7. Server change is blocked until the owner confirms; queue bytes are never rewritten.

## What the KOReader source says about this design

From public files at tag v2026.07.1, summarised by a documentation-reading subagent on 2026-11-07 (not re-read by me, not observed on a device). The `base` submodule that holds the TLS and socket layers could not be read.

- **Never turn Wi-Fi on.** `NetworkMgr:runWhenOnline`, `runWhenConnected`, `willRerunWhenOnline`, `goOnlineToRun` and `beforeWifiAction` may enable Wi-Fi or show a prompt depending on the user setting `wifi_enable_action`; none of them may be called. `isOnline()` runs a DNS lookup of a Microsoft host, so it also should not be used as a state check. Use only the cached `getWifiState()` / `queryNetworkState()` or the device backend's `isConnected()`.
- **How the stock sync plugin sends.** `kosync` uses an asynchronous Turbo HTTP client inside a coroutine when `UIManager.looper` exists and a plain blocking call otherwise, with short timeouts (2 s block / 5 s total for progress, 5 s / 10 s for login) set through `socketutil.set_timeout`; it does not use a subprocess. It sends on suspend and then may enable Wi-Fi, which this design deliberately does not do.
- **Timeouts.** `socketutil.set_timeout(block, total)` also sets the `http` and `https` timeouts; defaults are 60 s block and no total limit; the total limit is checked only when data arrives.
- **Scheduled callbacks are not contained.** An error inside a `UIManager:scheduleIn` or `nextTick` callback leaves the main loop; every P2 callback must run its work under `pcall`.
- **Settings are not written atomically.** `LuaSettings:flush()` writes the target file directly (with fsync and a `.old` backup older than 60 s). A crash during the write can truncate it; a reader falls back to `.old` only if it exists. KOReader's own plugins keep credentials in clear text there (`kosync` stores an unsalted MD5 as its credential). Keeping the URL and token in the plugin's SQLite state instead would be atomic, at the cost of being invisible to the owner.
- **Settings directory.** `DataStorage:getSettingsDir()` is the data directory plus `/settings`; the data directory comes from `KO_HOME` or the working directory, with no Kindle-specific branch, so the Kindle path is inferred, not read.
- **TLS verification.** Not found in any file read (`socketutil` loads `ssl.https`, but no CA file, path or verify mode appears). Verified TLS therefore remains an open requirement.

## Not decided (owner input needed)

1. **Blocking.** Whether a synchronous request with a short timeout on the UI thread is acceptable, or a subprocess is required. The stock sync plugin uses an asynchronous client with short timeouts and falls back to blocking; whether that client exists on the Kindle build is unknown.
2. **Token entry.** Typing a long token on the device versus the owner placing a settings file in the private settings directory; and whether the token lives in a `LuaSettings` file (visible, not atomic) or in the SQLite state (atomic, not visible).
3. **TLS roots.** Which CA bundle the device's Lua TLS stack can verify against, and the failure message when none is found. The relevant code is in the `base` submodule and has not been read.
4. **Cap.** A retention limit for undeliverable packets, or keep everything until delivered.
5. **Progress cadence.** Once per minute plus boundaries and a five-minute batch seal, as in the approved task, or event-driven only.

## Device unknowns (carried to I1)

HTTP and TLS library availability and behavior, background execution under suspend, network state API, settings file permissions, and the real timing of acknowledgements. None of these can be established by unit tests.

## Order of work

1. Outbox reader and delivery state with crash tests.
2. Acknowledgement router and idempotence tests for each P1 hook.
3. Transport with a fake server contract test against the real validators in `contracts/`.
4. Scheduler, settings, profile bootstrap and `Entry:configure` wiring.
5. Menu, packaging allowlist and install guide.
6. Independent review, then register the verifier and run a fresh full gate.
