# Product requirements

Status: decisions recorded from the user's design interview on 2026-11-01, including the public-repository requirement. These supersede earlier product assumptions in the research notes. The revised implementation plan still requires user review; no application is implemented.

## Product and scope

- One owner and one KOReader device per installation initially. Independent users deploy independent instances with their own credentials and configuration.
- The first release includes all four reference screens and their features: overview, yearly calendar, book details with progress history/session journal, and searchable highlights/notes with covers. It also includes streaks, annual reading goals, rereading cycles, saved vocabulary count and connection settings.
- EPUB, MOBI and PDF with a text layer are supported targets. AZW3 is excluded. Image-only PDF requires prior OCR outside this service.
- The web panel uses HTML/CSS/JavaScript and SVG. Express is the API backend; PostgreSQL is permanent storage. Initial managed deployment is Vercel Hobby + Neon Free; standalone deployment is a first-release requirement too.
- Sync sends reading data from KOReader to the service. Position transfer between formats, browser reading and editing Kindle notes from the panel are outside the agreed scope. Administrative grouping, goals and device setup are panel actions.

## Reading volume and time

- A conditional page is 2000 characters including spaces by default. Store exact character counts; round only for display. Historical totals are stable across font/layout changes.
- Count the actually viewed text ranges; a jump from page 10 to page 100 must not credit intervening text. Extraction and qualification of visible ranges require a compatibility prototype, especially for zoomed/reflowed PDF.
- The same passage is credited once per reporting day within each source file. On another day it can be credited again. Cross-format deduplication is not required: reading the same passage in EPUB and PDF may credit it twice on that day, even under a shared book card.
- Sessions report new volume for that day, including zero new pages when only rereading. Count all active rereading time according to KOReader's native time rules.
- Use KOReader's active-time estimate, not a new independent attention timer. Archive credited records in the plugin/service so clearing KOReader statistics does not delete service history.
- A session ends on sleep, closing the book or switching books. Progress history begins with tracked observations; do not invent prior percentages from page totals.
- Reporting timezone is instance configuration. Split active intervals at the instance's local midnight. Week begins Monday. Store timestamps in UTC; do not depend on the host timezone.
- Old native KOReader statistics are a separate approximate archive, not added to the new conditional-page series. Import existing annotations; mark later context extraction as backfill.
- Heatmap switches volume/time. Future dates do not count as missed days; averages use elapsed calendar days including zero days. Current streak continues if today or yesterday is active.

## Book identity, progress and completion

- A source file has an immutable SHA-256 identity. A user-facing book groups source files of the same edition/translation in different formats.
- Different translations, abridgements and revisions are separate book cards. Metadata alone is not assumed correct or complete.
- Automatically group only verified correspondences. Offer uncertain matches for user confirmation. Manual merge and split are reversible and retain source-specific notes, positions and reading records.
- A card shows the most recently opened source's progress and format. Each source has its own percentage history and position; do not interpolate across a source switch.
- Identical highlights in different sources remain separate annotations with their own notes and context.
- Finishing a book is an explicit action on the device. The annual goal counts unique grouped books completed that year. Rereading is an explicit new cycle and does not count as an additional unique book in that year's goal.
- Vocabulary count is the unique saved words from Vocabulary Builder, not all dictionary lookups or words read.

## Annotation context and archive

- Capture the text of the highlight's current page plus one preceding and one following page at creation. For a multipage highlight, include the full selected range plus its neighbours. For PDF, these are original document pages regardless of screen zoom.
- Save the captured text durably. Changing font/layout later does not replace it. Editing only the note preserves context; editing the selection recaptures it.
- Send a note immediately even if context fails. Persist a pending extraction task; retry when possible. Mark later extraction as backfill, since its page boundaries may differ.
- Missing first/last neighbours are normal. Context is text, not screenshots, layout or illustrations. A genuinely empty text page is not an extraction failure.
- Deleting a highlight on the device archives the corresponding service annotation, including note and context. Default lists/counts include active annotations; archive has its own filter/count.
- Removing a book file or clearing native statistics does not erase previously stored service data. An explicit service-data deletion/reset is a separate owner action.

## Configuration, portability and privacy

- Follow [the configuration policy](configuration.md). Runtime settings and secrets are installation-owned; the repository contains names, empty secret slots and generic examples only.
- Neon is a PostgreSQL deployment option, not a required application API. Vercel-specific code is isolated from core Express logic. Standard PostgreSQL and a standalone Node.js deployment must pass the same functional tests.
- Owner authentication and device tokens are separate. Device access is limited to its sync operations and nonsecret sync configuration; it cannot read the owner's library or other credentials.
- Without network access, retain the queue. Do not wake the device or enable disabled Wi-Fi for retries. Delivery within seconds is a target for an already available connection, not a network guarantee.
- Free-tier exhaustion retains undelivered data; never automatically enable paid services. Secrets and private reading content stay out of Git, public assets, fixtures, logs and container images.
