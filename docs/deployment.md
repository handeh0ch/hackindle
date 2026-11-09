# Deployment and release checks

Status: prepared 2026-11-09 for I2. **Nothing here has been deployed or published.** The commands are the implemented ones from [server-setup.md](server-setup.md); the container has never been built; no cloud account was used. Deployment, pushing and publication need a separate owner instruction ([configuration policy](configuration.md)). Keep every populated value (database URLs, tokens, owner password, your domain) in ignored `.env` files or the host's secret store, never in Git.

## 1. Standalone Node.js with PostgreSQL

Needs Node.js 24 (the declared engine is >=22.14), a PostgreSQL server you operate, and a reverse proxy that terminates HTTPS (the Kindle must reach the server over verified TLS; the plugin accepts plain `http://` only for localhost).

1. Install dependencies from the lockfile: `npm ci --omit=dev --ignore-scripts` (needs your approval on the owner's machine; keep caches on P:).
2. Create a private `.env` from `.env.example`: `DATABASE_URL`, `APP_ORIGIN` (your HTTPS origin, no trailing slash), `REPORT_TIMEZONE` (IANA name; frozen at first start), `PAGE_CHARACTERS` (frozen), `HOST`, `PORT`, `TRUST_PROXY` (the real number of proxy hops; with 0 behind a proxy all clients share one address and five failed logins lock the owner out).
3. Migrate, create the owner, start:

   ```powershell
   node --env-file=.env scripts/migrate.js
   node --env-file=.env scripts/setup-owner.js
   node --env-file=.env index.js
   ```

   Bootstrap needs an interactive terminal, asks for the password (at least 12 characters) and refuses to replace an existing owner. There are no default credentials. The panel is served at `/`, the API under `/api/v1`.
4. Put a reverse proxy in front (TLS certificate for your domain, forward to `HOST:PORT`, set `TRUST_PROXY` to the number of proxies). Verify HTTPS from the Kindle's network before relying on it.
5. Keep the process running with your platform's supervisor (systemd, a Windows service wrapper, or the container below). Restart it after configuration changes.
6. Create the first device token in the panel (**Connection**), then follow [plugin-install.md](plugin-install.md).

PostgreSQL TLS: use your provider's connection string and keep certificate verification on; do not disable it globally.

## 2. Container (not built)

The repository has a `Dockerfile` (Node 24 Alpine, explicit `COPY` of the application, `public/`, migrations and the four CLI scripts, runs as the `node` user, installs production dependencies without scripts) and `compose.example.yaml`. A unit test checks that the image copies `public/` and never copies env files, local data, books or tokens, and that `.dockerignore` excludes them.

Before the first build the owner must approve the image download, and the base image should be pinned by digest. Steps for the owner:

1. Pick the base image tag you trust (the Dockerfile says `node:24-alpine`) and resolve its digest from the official registry; record the tag and digest in the report.
2. Replace the `FROM` line with `FROM node:24-alpine@sha256:<digest>` and commit that change.
3. Build and run with environment injection, never baked values:

   ```bash
   docker build -t hackindle:local .
   docker run --rm -p 127.0.0.1:3000:3000 --env-file .env hackindle:local
   ```

   Migrations and owner bootstrap run as one-off commands in the same image: `docker run --rm -it --env-file .env hackindle:local node scripts/migrate.js` and `... node scripts/setup-owner.js` (the second needs `-it`).
4. With Compose: copy `compose.example.yaml`, supply the variables from your environment, optionally add a local PostgreSQL service for testing.

Inspect the built image before sharing it (see section 5).

## 3. Backup and restore

Export writes a JSON file (mode 0600, refuses to overwrite an existing path). It holds reading data and notes and **no** credentials, token hashes or sessions.

```powershell
node --env-file=.env scripts/export-backup.js private/backup-2026-11-09.json
```

Restore into another database: migrate it, make sure the instance exists with the same `REPORT_TIMEZONE` and `PAGE_CHARACTERS` as the backup (a mismatch is refused with `policy_mismatch`), then run:

```powershell
node --env-file=.env scripts/import-backup.js private/backup-2026-11-09.json
```

Afterwards create a fresh device token in the panel and update `hackindle.conf`; identities and totals are preserved, credentials are not. Store backups outside the repository (`backups/`, `exports/` and `private/` are ignored). A free hosting plan with a short recovery window does not replace an independent backup. Restoring an older backup leaves a gap the plugin does not heal (see [testing.md](testing.md) item 33). The restore path has run once against a throwaway PostgreSQL 18.6 container with synthetic data; verify it on a disposable database before relying on it.

## 4. Vercel + Neon Free (guide, nothing deployed)

Facts below come from the official pages named in brackets, read on 2026-11-09 through a fetch tool; the page dates are those the pages showed. Anything marked **unverified** was not found on those pages or depends on an adapter that does not exist yet. Project ids, domains and credentials belong to the operator and never to the repository.

### What is known

- **Vercel and Express.** Vercel deploys an Express app as one Vercel Function with zero configuration; the entry file (`app`, `index`, `server`, also under `src/`) must import Express and either export the app as the default export or listen on a port. `express.static()` is ignored: static files must live in `public/**` and are served from the CDN with default headers, which `vercel.json` can override [vercel.com/docs/frameworks/backend/express, updated 2026-08-10]. This repository serves `public/` itself with a CSP and other headers (`server/app.js`); on Vercel that code path does not apply to the files, so equivalent headers (CSP `default-src 'self'`, `nosniff`, `Referrer-Policy: no-referrer`) must be configured in `vercel.json` for `public/**`. **Unverified:** the exact `vercel.json` syntax and that the CDN-served page keeps working under that CSP.
- **Hobby plan.** Non-commercial personal use only; per month 1,000,000 function invocations, 4 CPU-hours active CPU, 360 GB-hours memory, 100 GB fast data transfer; request and response body limit 4.5 MB (413 above it) and function duration 300 s (default and maximum); exceeding a limit blocks usage until 30 days have passed, there is no billing cycle [vercel.com/docs/plans/hobby, updated 2026-09-14; vercel.com/docs/functions/limitations, updated 2026-08-24]. The sync protocol stays inside these: direct packets are at most 1 MiB, upload chunks at most 1 MiB, covers 64 KiB. Bundle size limit 250 MB uncompressed. **Not stated on the pages read:** whether custom domains get automatic HTTPS on Hobby, and the supported Node.js versions and how to select them.
- **Neon connection strings.** The pooled host has the `-pooler` suffix (PgBouncer in transaction mode); the direct host does not. Neon recommends the pooled string for serverless runtimes and the direct string for schema migrations and administrative tools. Not supported through the pooler: `SET`/`RESET`, `LISTEN`/`NOTIFY`, SQL-level `PREPARE`, session-level advisory locks, `LOAD`, some temporary tables; protocol-level prepared statements are supported [neon.com/docs/connect/connection-pooling, updated 2026-10-19]. Examples use `?sslmode=require`. **Not stated:** `channel_binding` behavior and how `pg` interprets `sslmode`; test with the real string and keep certificate verification on.
- **Neon Free plan.** 100 projects, 10 branches per project, 1 GB storage per project, 100 compute-hours per project per month, autosuspend after 5 minutes of inactivity (cannot be disabled), 6 hours of instant-restore history, 5 GB egress per project per month. When compute hours or egress run out, compute is suspended until the next period; when the storage cap is reached, writes that grow storage fail. A summary of the plan page says limits do not delete data (that part of the page was truncated when read, so treat it as **unverified**) [neon.com/docs/introduction/plans, updated 2026-11-04].

### What this means for this application

- Run `scripts/migrate.js` from your own machine with `DIRECT_DATABASE_URL` set to the **direct** Neon string (the migration script falls back to `DATABASE_URL` when it is unset, so set both). Startup does not read the migration files: it only checks the instance policy, so the function bundle needs no `db/migrations`.
- Set only the pooled `DATABASE_URL`, `APP_ORIGIN` (your HTTPS origin), `REPORT_TIMEZONE`, `PAGE_CHARACTERS` and `TRUST_PROXY` as Vercel environment variables; `.env` files are not deployed. Do not put the direct URL into the function's environment.
- Locking in the code is transaction-scoped (`pg_advisory_xact_lock` in migrations and the login throttle, row locks in sync), which is compatible with transaction pooling. The owner read endpoints run `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` inside an explicit transaction. **Verified 2026-11-09 on a real Neon pooled connection** (project region aws-eu-central-1, PostgreSQL 18.6, temporary branch, synthetic data): all eleven owner reads, sign-in, a CSRF write with read-back, device token rotation and device sync worked through the `-pooler` host with `pg`. The Neon CLI gives the strings as `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct); map the second one to `DIRECT_DATABASE_URL` for migrations. The strings carry `sslmode=require&channel_binding=require`; `pg` accepted them and currently treats `require` as `verify-full` (certificate checked), but the next `pg` major changes that, so write `sslmode=verify-full` explicitly in the Vercel `DATABASE_URL`. Latency from the owner's machine to the EU region: first sign-in about 1.8 s, owner reads 0.2 to 1.3 s (cold compute included); not measured from Vercel.
- `server/unicode-lower.js` reads `server/unicode-casing.json` at startup with `readFileSync`. Vercel's file tracing must include that file: **unverified**; check the first deployment's logs.
- Cold starts add Neon's resume time (autosuspend after 5 minutes) to the first request after a pause. The plugin retries, but expect a slow first sync; measure it (testing.md 2.7).

### The adapter (written, not deployed)

Added 2026-11-09, covered by `tests/server/vercel.test.js`: `app.js` at the repository root is the Vercel entry. It imports Express, exports an app that opens no listener, hands every request to `server/provider.js` (which builds the real application lazily on first use) and answers an initialization failure with a generic `internal_error` while logging only the setting names. `vercel.json` repeats the security headers of the Express static mount for the CDN-served `public/**` files (a test keeps the two identical). `.vercelignore` keeps env files, local data, tests, docs and the plugin out of the upload. **Nothing has run on Vercel**: whether `/` is served from `public/index.html`, whether the CDN applies the headers, whether `unicode-casing.json` is traced into the bundle, which Node version is used and all stay unverified until the first deployment (the pooled-connection `SET TRANSACTION` question is answered, see below).

### Steps for the owner (nothing below was run by an agent)

Agents must not create accounts or handle your credentials; each step is yours, and a deployment needs your explicit instruction.

1. **Neon.** Create a Free project (choose a region near your Vercel region). In the connection panel copy two strings: the **direct** one and the **pooled** one (host contains `-pooler`). Keep both private.
2. **Migrate and create the owner from your own machine**, against the direct string, in a private `.env` outside Git (`DATABASE_URL` and `DIRECT_DATABASE_URL` both set to the direct string for this step, plus `APP_ORIGIN`, `REPORT_TIMEZONE`, `PAGE_CHARACTERS` exactly as you will set them on Vercel, because the policy is frozen at first start):

   ```powershell
   node --env-file=.env scripts/migrate.js
   node --env-file=.env scripts/setup-owner.js
   ```

3. **Vercel project.** Create a project (Hobby) and note its production URL: `APP_ORIGIN` must be exactly that `https://...` origin without a trailing slash. Deploy either from a connected Git repository (needs a remote, which is your decision) or with the Vercel CLI from this directory, which uploads the files except those in `.vercelignore` (installing the CLI is a download that needs your approval on this machine).
4. **Environment variables in Vercel** (Production, and Preview if you use previews): `DATABASE_URL` = the **pooled** string, `APP_ORIGIN`, `REPORT_TIMEZONE`, `PAGE_CHARACTERS`, `TRUST_PROXY` (start with `1`; how many proxy hops Vercel adds is unverified, so check that two failed logins from different networks do not lock each other out). Do not add the direct string. Choose Node.js 24 in the project settings if offered; the repository declares `>=22.14.0`.
5. **First check.** Open the URL: the panel must load and show the sign-in form. If you get `internal_error`, read the function log: it names the missing or invalid setting. Sign in, open **Connection**, create the device token and keep it private.
6. **Kindle.** Follow [plugin-install.md](plugin-install.md): `url` is the same `https://` origin, `token` the one you just created. Then start the checklist in [testing.md](testing.md), TLS items first.
7. **Afterwards.** Watch the Neon and Vercel dashboards for quota use, and take a backup (section 3) before trusting the data. If `SET TRANSACTION` fails on the pooled connection (owner reads return errors), tell me: the fix is to use the direct string as the runtime `DATABASE_URL` or to change that statement.

## 5. Release checks (run before any publication)

These were run on 2026-11-09 against the working repository; re-run them for any release candidate.

1. **Ignore rules.** `git check-ignore -v` reports ignored for `.env`, `.env.production`, nested `.env.local`, `hackindle.conf`, `*.sqlite3`, `backups/`, `exports/`, `*.dump`, `*.pem`, `*.key`, credential JSON files, `*.epub`, `*.pdf`, `*.mobi`, `.local/`, `private/`, `data/`; and not ignored for `.env.example` and `db/migrations/*.sql`.
2. **Secret scan of the full history and the staged diff.** Gitleaks 8.30.1 (official release, archive checksum verified against the release checksums when it was installed under `.local/tools`; confirm the version with `gitleaks version`):

   ```powershell
   .local/tools/gitleaks-8.30.1/gitleaks.exe git --redact --log-opts="--all" .
   .local/tools/gitleaks-8.30.1/gitleaks.exe git --staged --redact .
   ```

   Result on 2026-11-09: 0 findings in 40 commits. A directory scan flagged only ignored, untracked files (a synthetic test token under `.superpowers/` and README examples inside the scanner's own folder). A CI job that runs this on every push needs the scanner pinned from an official source; it is not set up yet (no `.github/workflows`).
3. **Plugin archive.** `node scripts/build-plugin.js --zip` builds `.local/build/hackindle.koplugin.zip`; a unit test asserts it contains only the plugin's Lua modules. On 2026-11-09 it held 42 Lua files and no URL, token or credential pattern.
4. **Container image.** After the first build: `docker run --rm hackindle:local ls -R /app` and `docker history hackindle:local`; confirm there is no `.env`, `.local`, `private`, backup, dump, book or populated config file, and run the secret scanner on the saved image (`docker save`) if your scanner supports it. Not done: the image does not exist yet.
5. **Logs and errors.** Configuration errors name settings but never print values; the server logs only an error name and database code. Check your proxy and platform logs do not record `Authorization` headers.
6. **Authorship.** The repository keeps the owner's existing author metadata; no history rewrite is requested.

## 6. Open items and what is unverified

- No deployment of any kind was made; HTTPS from the Kindle, cold start, retry behavior and quotas are untested.
- The Vercel adapter (`app.js`), `vercel.json` and `.vercelignore` exist and are unit-tested but have never run on Vercel; every **unverified** point in section 4 stays open until the first deployment.
- The panel and the server ran together once on a throwaway PostgreSQL 18.6 container with synthetic data (2026-11-09, see [testing.md](testing.md) section 3); that does not cover Neon, a pooled connection, TLS or a reverse proxy.
- The container image has never been built; the base image digest is not pinned (needs your download approval).
- CI (secret scan on every push) is not configured; it needs a scanner/action pinned from an official source and a remote repository, which are separate owner decisions.
