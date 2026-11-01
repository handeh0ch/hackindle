# Synchronizing Kindle with a self-hosted server

Checked against primary sources on November 1, 2026. This is initial research, not the current product specification. At the time of the research, the device and supported formats had not yet been confirmed. Current interview decisions are in [requirements.md](requirements.md), and the updated contract is in [kindle-sync-data-spec.md](kindle-sync-data-spec.md). The code is not implemented, and device compatibility still needs verification.

## Conclusion

If reading in KOReader is an option, a separate Kindle application is usually unnecessary: first try the existing AnnotationSync plugin with a self-hosted WebDAV server. If a custom protocol and server are needed, a small KOReader Lua plugin can obtain progress and annotations from inside the running reader. If the stock Amazon reader is required, the task is substantially harder: start with one-way export to the server and inspect files from the actual device. Third-party implementations that write progress back do exist, but the sources studied do not establish a public, stable Amazon interface for progress and annotations.

This is an engineering recommendation, not a claim of verified compatibility with a particular Kindle.

## What the video shows

Based on the main agent's visual inspection of frames, the approximately 25-second video shows a custom Kindle interface and a desktop dashboard: a library and book progress, reading sessions, pages/minutes, daily streaks and an annual heatmap, highlight search, and a dictionary with spaced repetition. These frames show user-facing screens but do not confirm the network exchange mechanism, underlying reader, storage format, or bidirectional synchronization. The source is the video attached by the user; these are visual observations, not information from the project repository.

## Existing options

| Option | Progress | Highlights and notes | Self-hosted server |
| --- | --- | --- | --- |
| Built-in KOReader Progress sync | Yes, sending and receiving | Not part of the standard protocol | Official koreader-sync-server |
| KOReader Export highlights and notes | Outside its scope | Export, including JSON/Markdown; separate remote targets | File export and a custom target are possible |
| AnnotationSync.koplugin | Yes, with version requirements | Bidirectional merging of highlights, notes, and bookmarks | WebDAV, including self-hosted |
| Booklore's documented KOReader integration | Yes | Not documented for this integration | Booklore itself |
| Agent for the stock reader | State can be read for the formats studied | Extraction is possible, depending on firmware | Custom receiver; writing back requires separate research |

Sources for the table rows are detailed below. The absence of a feature in Booklore's documentation does not prove that no third-party plugins exist.

## KOReader: confirmed interfaces

Standard kosync describes `PUT /syncs/progress` and `GET /syncs/progress/:document`. It transfers a document identifier, position, fraction read, and device; optional metadata is also supported. This schema has no collection of highlights/notes. The official server can be self-hosted. [API schema](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/api.json), [server](https://github.com/koreader/koreader-sync-server).

The current plugin uses page numbers for fixed-page documents and XPointer for reflowable text. It has events for document opening/closing, page turns, suspend/resume, and network availability; unsent progress is queued. This is a useful example for a custom plugin, but the code of the installed release should be checked because `master` changes. [kosync implementation](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/main.lua).

KOReader's internal annotations contain highlighted text, a user note, creation/modification times, range start/end, a page, and EPUB CFI for suitable documents. The existing exporter supports JSON, Markdown, and remote targets; additional targets connect through a provider. Exporting annotations and synchronizing annotations bidirectionally are different tasks. The latter requires rules for identity, modification, and deletion. [ReaderAnnotation](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerannotation.lua), [exporter](https://github.com/koreader/koreader/blob/master/plugins/exporter.koplugin/main.lua), [JSON](https://github.com/koreader/koreader/blob/master/plugins/exporter.koplugin/target/json.lua).

The existing AnnotationSync plugin supports annotation merging and self-hosted WebDAV. In the current README, progress requires KOReader 2026.07+ with Cloud storage+; basic annotation synchronization also works on older releases. An important caveat: `Sync All` processes locally modified documents, while `Manual Sync` performs a full pull/merge for the active book. This is a separate third-party plugin, not an extension of the standard kosync protocol. [Author's README](https://github.com/dani84bs/AnnotationSync.koplugin).

Booklore documents `/api/koreader`, separate credentials, and Binary matching mode: the server and device must have the same file. KOReader and web reader progress are independent by default; the optional XPointer → EPUB CFI conversion is approximate and may land in a chapter instead of on the exact page. [Booklore documentation](https://github.com/booklore-app/booklore-docs/blob/master/docs/integration/koreader.md).

KOReader does not read KFX or DRM-protected books, and EPUB is recommended as the primary format. A transition from the stock reader therefore cannot be promised to be seamless for the entire Amazon library. [Official installation instructions](https://github.com/koreader/koreader/wiki/Installation-on-Kindle-devices).

## Stock reader: what is known and what depends on firmware

The KRDS parser reads `.azw3f`, `.azw3r`, `.mbp1`, `.mbs`, `.yjf`, and `.yjr`. Its code contains `lpr`, `fpr`, `updated_lpr`, positions, times, highlights, and notes. This is the result of reverse engineering, not a published Amazon SDK. The extensions cannot be considered interchangeable, and no guarantee can be made that every file contains all required fields. [KRDS and parser source](https://github.com/K-R-D-S/KRDS), [field decoding](https://github.com/K-R-D-S/KRDS/blob/master/krds.py).

In the developer's own research, KFX-Highlights reports a transition around firmware 5.19 from `.sdr/*.yjr` to `system/ksdk/.annotations/amzn1.account.<ACCOUNT_ID>/ksdk_annotation_v1.db`; old `.yjr` files may remain without annotations. The tool reads three tables: `server_view`, `local_edit`, and `nonsyncable_annotations`. A highlight is stored as a range of positions, and the book file is needed to reconstruct its text. **This is an observation by the tool's author; the exact version boundary and applicability to all models cannot be confirmed.** [KFX-Highlights description and limitations](https://github.com/aakar/KFX-Highlights).

`documents/My Clippings.txt` is convenient as a simple export source, but it is not a complete, up-to-date database: KOReader's exporter implementation explicitly treats it as an append-only log. It cannot provide the current reading position or reliably reconstruct deletions/edits. KFX-Highlights also reports that it stops being updated on the newer firmware versions studied. A watcher for My Clippings alone is therefore insufficient. [My Clippings handling in KOReader](https://github.com/koreader/koreader/blob/master/plugins/exporter.koplugin/main.lua), [observation about newer firmware](https://github.com/aakar/KFX-Highlights#where-annotations-live).

Without device samples, the following remain unknown: the actual storage location, when the position is saved, whether annotations contain text or coordinates, how book identifiers map to the server library, and whether incoming changes can be applied safely. The proposed first stage is to read a consistent snapshot of the state, retain the original coordinates and format, and send it to the server; do not modify live `.sdr` files or stock reader databases.

For potential reuse, `kaikozlov/kindle.koplugin` deserves separate investigation: its author claims exact bidirectional position mapping between KOReader and the stock reader through an XPointer ↔ Kindle coordinates map, KRDS reading/writing, and conflict resolution. The architecture separates `position_map`, `kindle_state_reader`, and `kindle_state_writer`. This is a specific open-source example of integration with a private format, not a universal Amazon API or a ready-made remote server. The claimed feature concerns position and cannot automatically be extended to notes and highlights. Compatibility with the user's device and newer annotation stores requires verification. [Author's README](https://github.com/kaikozlov/kindle.koplugin), [architecture](https://github.com/kaikozlov/kindle.koplugin/blob/master/AGENTS.md).

## Launching, ABI, sleep, and Wi-Fi

KUAL provides a launch menu: in KOReader's standard extension, `menu.json` invokes a shell script with arguments. This is a suitable wrapper for "Sync now" or launching an agent, but a menu item alone does not create a service with a guaranteed lifecycle. [Working extension example](https://github.com/koreader/koreader/blob/master/platform/kindle/extensions/koreader/menu.json).

A native agent build must match the device: the official instructions distinguish KindleHF for FW ≥ 5.16.3, PW2, and other older families. A single ARM binary cannot be promised to work on all Kindles. [Package matrix](https://github.com/koreader/koreader/wiki/Installation-on-Kindle-devices), [project toolchain](https://github.com/koreader/koxtoolchain).

KOReader manages networking through Kindle LIPC and accounts for suspend/resume; its powerd code notes that an RTC wakeup is set only in the ReadyToSuspend state. The practical conclusion is that an ordinary background process timer should not be treated as a guarantee of sending data during sleep. A persistent local queue and sending while the device is active/network is available are sufficient for the first version; periodic wakeups are a separate feature to verify on the selected model. [Kindle device backend](https://github.com/koreader/koreader/blob/master/frontend/device/kindle/device.lua), [Kindle powerd](https://github.com/koreader/koreader/blob/master/frontend/device/kindle/powerd.lua).

## Minimum checks before implementation

1. Clarify the model, FW, reader, formats, and synchronization direction: server backup only, or sending changes back to Kindle as well.
2. In a test book, change the position, add a highlight and a note, then edit/delete them; compare the saved data after closing the book.
3. Check repeated sending without duplicates, offline → online, and suspend → resume; for bidirectional mode, check conflicts and deletion separately.
4. If KOReader is acceptable, first test the existing AnnotationSync + WebDAV option. Build a custom plugin/server only for requirements that the existing option does not cover.

These checks are proposed criteria; they have not yet been performed.
