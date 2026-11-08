# Plugin installation and connection

Owner steps. Agents prepare the plugin and these instructions only; copying files to the Kindle is always done by the owner. Nothing here has been run on a device: every KOReader and network behavior below is an unverified assumption collected as I1 acceptance items at the end.

## Build

```bash
node scripts/build-plugin.js --zip
```

This writes `.local/build/kindle_sync.koplugin/` and `.local/build/kindle_sync.koplugin.zip`. The archive holds only the plugin's Lua modules (a test checks this), so no settings, token, state database or book can be in it. KOReader names a plugin after its directory, so the folder must be called exactly `kindle_sync.koplugin`.

## Install and connect

1. Copy the `kindle_sync.koplugin` folder into KOReader's `plugins` directory and restart KOReader.
2. Create a device token on the server (`POST /api/v1/owner/device/token`, see [api-v1.md](api-v1.md) and [server-setup.md](server-setup.md)). The token is shown once. To move an existing server binding to a replacement device, call `POST /api/v1/owner/device/unbind` first.
3. Create `kindle_sync.conf` in KOReader's settings directory (the folder that holds `kindle-sync.sqlite3` once the plugin has run):

   ```text
   url = "https://sync.example.org"
   token = "your-device-token"
   -- optional: where the device keeps IANA time zone files
   zoneinfo_dir = "/usr/share/zoneinfo"
   ```

   Rules: one `key = "value"` per line, `--` starts a comment, the file is read and never executed or written by the plugin. The URL must be `https://`, with no credentials, query or fragment; plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. The token may contain only letters, digits, `-` and `_` (16 to 512 characters). Without this file the plugin does nothing.
4. Open any book. The first synchronization needs a connection: open the reader menu, choose **Kindle Sync > Sync now**. This fetches the server profile (time zone, page size, reset generation), stores it, and starts capture. After that the profile comes from the stored copy, so reading works offline.

## What runs and when

- While a book is open a timer checks the queue about every five minutes, and again right after each successful request while a backlog remains. It sends one request at a time (5 s block timeout; the 30 s total limit is also checked in the response sink, but whether KOReader's socket layer enforces it is an I1 item) and never follows a redirect (a redirect pauses delivery as `redirected`, so the token cannot be forwarded) and only if KOReader already reports a connection. It never turns Wi-Fi on and never uses the network manager calls that can.
- Closing a book makes one bounded last attempt (at most five requests or twenty seconds). Suspending stops the timer; resuming restarts it.
- A packet is removed from the device only after the server's answer matches that exact packet. Network errors, timeouts, 429 and 5xx keep the packet and retry after 5, 15, 60, then 300 seconds, longer if the server sends `Retry-After`. A lost answer simply resends identical bytes; the server answers `duplicate`.
- Packets over the server's direct limit (1 MiB) go through the chunked upload and resume where they stopped.
- When a pause stops the queue (a redirect, 404, 409, rejected token and so on) the plugin shows one message with the reason and code; it does not repeat it on every later attempt. **Sync now** clears the pause and keeps a partly uploaded large packet, so the upload resumes instead of starting a second one on the server.
- Menu: **Status** (queue length, last success, pause reason), **Sync now** (also clears a pause and retries), **Mark book as finished**, **Start new read cycle** (re-reads have no automatic signal).

## Pause reasons

| Status | Meaning | What to do |
| --- | --- | --- |
| `token_rejected`, `forbidden` | The server refused the token | Create a new token, edit `kindle_sync.conf`; the pause clears itself when the file changes |
| `instance_mismatch`, `device_mismatch` | The server is another installation, or this token is bound to another device | Fix the URL/token, or call `unbind` on the right server; clears when the file changes |
| `server_changed`, `policy_changed`, `generation_regressed` | The profile differs from the one this device accepted (new instance, other time zone or page size, lower reset generation) | The queue is never sent to such a server. Restore the right server, or accept losing the unsent data by deleting `kindle-sync.sqlite3` from the settings folder (owner action) |
| `conflict` (`future_generation`, `packet_conflict` ...) | Protocol drift or a server restored from an older backup | Keep the device state; check the server first, then **Sync now** |
| `rejected`, `redirected`, `too_large`, `corrupt_packet`, `hook_failed` | A client or server problem; the packet is kept | Report with the code; **Sync now** retries |
| `reset_detected`, `reset_unsupported` | The owner reset the server; the profile has a newer generation | Capture is stopped (see below) and the old queue is discarded by the server; this is a known limit until post-reset capture is supported |

## Captured now, and what is not

Captured at reset generation 0: source identity and metadata, credited reading ranges with character counts, sessions and cycles, the vocabulary list. Not captured, by design of the current state:

- **Continuous scroll mode.** KOReader sends no page updates there. The first scroll update is recorded as a capture gap and nothing is credited until page mode returns.
- **Native reading time, annotations and legacy statistics.** They need device-verified bindings (statistics book association and epoch, annotation identity) that do not exist yet. Reading is credited with unavailable timing and the server shows it as such. How often native time would be available is measured from server data during I1.
- **Anything after a server reset.** When the stored or fetched profile has a reset generation above 0 (also on a fresh device against a reset server) the plugin stops capture and the status says "The server was reset. Capture is stopped". It keeps delivering the old queue, which the server discards. Resuming needs the native baseline evidence that is not wired yet.
- **Offline first reading of a new book** is captured: only the queued metadata snapshot is required, because the outbox is delivered in order.

## I1 acceptance items (owner-run, unverified)

1. TLS: that `ssl.https` verifies the server certificate on the Kindle build and which CA bundle it uses. Until this is observed, treat the token as exposed to an active network attacker on untrusted Wi-Fi.
2. `NetworkMgr:isConnected()` reports state without prompting or enabling Wi-Fi.
3. Blocking requests on the UI thread (up to 30 s) are tolerable; if not, a subprocess is needed.
4. The settings directory location, file permissions, and that SQLite state survives suspend and a forced restart.
5. Time zone files exist at `zoneinfo_dir`.
6. The menu entry appears and `getSettingsDir()` is the folder used above.
7. Real counts of how many page turns carry native seconds, to decide whether native timing is worth keeping.
