# Free hosting for Kindle Sync

Checked against available official sources on November 1, 2026. This is historical research into options, not a deployed application. The root `AGENTS.md` did not exist at the time of the initial research. Current requirements for formats, accounting and public distribution are in [requirements.md](requirements.md); settings and vendor independence are covered in [configuration.md](configuration.md).

Following the interview, Vercel + Neon was selected as the initial managed option. The application must also run as a regular Node.js application/container with standard PostgreSQL; provider accounts and addresses are not part of the business logic. The public template contains empty secrets; actual settings belong to a separate instance.

## Conclusion

Free hosting is realistic for personal use. Express is suitable. Vercel requires an external persistent database and changes to the current protocol for large snapshots. A local SQLite file on serverless hosting is unsuitable as the primary database. The size of Express itself does not address the platform's limits on request bodies, storage and quotas.

Two reasonable options; the first is the primary recommendation:

1. **Vercel + Express + Neon Postgres** — a different SQL dialect, but the database wakes automatically after inactivity. This is more convenient for a personal application that may go unused for several weeks.
2. **Vercel + Express + Turso Cloud/libSQL** — close to the earlier SQLite design, but archiving after prolonged inactivity must be taken into account.

This is an engineering recommendation based on the researched limits, not a guarantee of free operation at any volume.

## Vercel

Vercel officially supports Express: the application becomes a single Vercel Function. Static files are placed in `public/**`; the platform ignores `express.static()`. [Express on Vercel](https://vercel.com/docs/frameworks/backend/express).

Hobby is intended for personal, noncommercial use. Free limits include 1 million Function invocations, 4 hours of Active CPU and 100 GB of Fast Data Transfer; reaching the limits may suspend service. [Hobby](https://vercel.com/docs/plans/hobby).

The Functions filesystem is read-only except for 500 MB of temporary `/tmp` space. This is not persistent storage for the database or user uploads. [Runtimes](https://vercel.com/docs/functions/runtimes).

Function request/response bodies are limited to 4.5 MB. Therefore, the current **16 MiB snapshot limit is incompatible with Vercel without a contract revision**. Even a few hundred highlights with three-page context may exceed the limit. Simply increasing `express.json({limit: ...})` does not bypass it. [Function limits](https://vercel.com/docs/functions/limitations).

A candidate protocol change: snapshot parts smaller than the platform limit, staging in the persistent database and an atomic commit only after all parts have arrived. A partially uploaded annotation list must not replace the active one. This is a proposal, not an already implemented mechanism. An alternative is to send immutable contexts separately, leaving references in the snapshot; this also requires a specification change. The choice depends on measurements from real books.

## Persistent database

| Service | Confirmed free resources | Inactivity and overages |
| --- | --- | --- |
| Neon | 1 GB of Postgres per project, 100 CU-hours/month per project, 5 GB of outbound traffic/month per project; Free signup without a card | After 5 minutes of inactivity, compute sleeps; a new query wakes it automatically. Exhausting the compute/traffic quota suspends compute until the next period or a plan upgrade |
| Turso | 5 GB of storage, 500 million rows read/month, 10 million rows written/month; Free without a card | The CLI documentation specifies archiving Free databases after 10 days of inactivity and a group restoration command; the quota documentation describes `BLOCKED` errors when limits are exceeded |

Sources: [Neon pricing](https://neon.com/pricing), [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero), [Turso pricing](https://turso.tech/pricing), [Turso usage](https://docs.turso.tech/help/usage-and-billing), [official Turso unarchive source](https://github.com/tursodatabase/turso-docs/blob/main/cli/group/unarchive.mdx). Neon's advertised wake-up time is a few hundred milliseconds; this is not a promise of overall sync latency.

Turso's rows read count means rows scanned, not just rows returned. Indexes matter. The plan's listed 3 GB of Monthly Syncs is a separate replica synchronization quota; it must not be presented as an overall HTTP traffic limit. [Usage](https://docs.turso.tech/help/usage-and-billing), [pricing](https://turso.tech/pricing).

### Turso engines and SDKs

Turso Cloud currently offers **two engines**: the mature libSQL (a SQLite fork) and the new Turso Database. Cloud hosting for the new engine is marked early preview, although the engine itself is described as production-ready. Do not confuse the service and engine names. [Cloud](https://docs.turso.tech/turso-cloud), [libSQL](https://docs.turso.tech/libsql).

Remote libSQL uses `@libsql/client`, including its `/web` variant; the new remote Turso uses `@tursodatabase/serverless`, which uses only fetch. These are different SDKs, not interchangeable names. The mature libSQL is acceptable for the current project with its simple SQL queries. [TypeScript SDK reference](https://docs.turso.tech/sdk/ts/reference). This choice was also checked through Context7 `/tursodatabase/turso-docs`.

### Covers without a third service

Small JPEG/WebP covers resized in advance can be stored as BLOBs in the same database and served through a separate authenticated route. SQL supports BLOBs, and the libSQL client accepts binary `ArrayBuffer`/`Uint8Array` values. This is an assessment of suitability for small thumbnails, not a recommendation to store EPUBs or large images in the database. [Turso data types](https://docs.turso.tech/sql-reference/data-types), [libSQL client API source](https://github.com/tursodatabase/libsql-client-ts/blob/main/packages/libsql-core/src/api.ts).

Optional object storage:

- Neon now includes 5 GB of Object Storage on Free, accessible through an S3-like API; the project's shared 5 GB of outbound traffic is divided among Postgres, storage and Functions. Object Storage availability depends on the region. [Storage overview](https://neon.com/docs/storage/overview), [pricing](https://neon.com/pricing).
- Vercel Blob Hobby includes 1 GB of storage, 10 GB of data transfer and 2 000 Advanced Operations, which include uploads. These quotas are separate from Functions; check the current table before choosing. [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).

A separate storage provider is not required for the first version.

## Render as an alternative for regular Express

A Free Web Service sleeps after 15 minutes without incoming traffic; waking it on the next request takes about a minute. Local files are lost on restart, redeploy and sleep; persistent disks are available only to paid services. Free Render Postgres expires after 30 days. A workspace receives 750 free instance-hours per month; bandwidth/build overages may lead to charges or suspension depending on payment settings. [Free services](https://render.com/docs/free), [disks](https://render.com/docs/disks).

Conclusion: Render Free + an external database is suitable for a prototype, but cold starts would compromise the requirement for fast note delivery. Local SQLite + Free Render is unsuitable for persistent storage. Render separately warns about Free limitations for production. Bypassing sleep with dummy requests is not proposed.

## Minimum proposed stack

- KOReader: Lua plugin; HTTPS JSON, local queue and retries.
- Server: Node.js + Express, optionally TypeScript; a single API and static page serving, without a continuously running background process.
- Data: SQL directly through the selected database's corresponding SDK; an ORM, Redis and a server-side queue are not yet required for one user.
- Interface: HTML/CSS/JavaScript; a small charting library may be selected separately. React/Next.js are not required for these screens.
- Authentication: a separate device token and owner session; the session must work after the serverless instance changes.

This is a design proposal; library versions and the build setup will be determined before implementation. Free hosting does not require adding Docker, Kubernetes or microservices.

## What to change and check before implementation

1. Select a database, then agree on an amendment to the draft that uses local SQLite.
2. Measure the text volume of real three-page contexts and a complete book snapshot; decide how to transfer data exceeding 4.5 MB without losing atomicity.
3. Do not resend contexts with every one-minute progress update: the sections are already independent; when annotations change, the full snapshot may also be large.
4. Check TLS/certificates, cold starts, timeouts and retries from the Kindle; do not claim verified latency before testing.
5. Check actual resource consumption after several days of reading. For example, 10 000 contexts of 30 KiB each amount to about 293 MiB of text alone, before indexes/metadata/overhead; 300 covers of 50 KiB each amount to about 15 MiB. This is an estimate, not a measured size of the user's library.
6. Provide export/backup: a free plan with a short recovery history does not replace an independent backup.

No deployments or paid accounts were created, and no plan changes were made. Free quotas and terms may change; they should be checked again before an actual deploy.
