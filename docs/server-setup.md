# Server foundation setup

The server implements configuration, migrations, owner/device authentication, sync ingestion, uploads, annotation archive/content, private covers, reset barriers, reports, grouping, goals, backup/restore and serves the owner panel from `public/`. See [deployment.md](deployment.md) for the full deployment, container, backup and release-check guide. Unit tests use a database boundary double. A one-off manual smoke test on PostgreSQL 18.6 (2026-11-07, throwaway container, scripts kept outside Git) exercised the six migrations, authentication, sync, uploads, covers, all owner reads against the shared contracts, locking, reset, backup and restore; no container build, provider or cloud deployment has been exercised, and the panel has not run against a real database.

## Prerequisites and private configuration

Use an existing approved Node.js installation, installed project dependencies and an operator-provided PostgreSQL database. The runtime target is Node.js 24; local unit checks currently use existing Node.js 22.14. Obtain approval before downloading dependencies, runtimes or container images. On the owner's machine, installations, caches and temporary files stay in the agreed project paths on P:.

Create a private `.env` from `.env.example` only if no `.env` exists. Otherwise edit the existing private file without overwriting it. Supply DATABASE_URL, APP_ORIGIN and the reporting policy; keep all populated values out of Git. DIRECT_DATABASE_URL is optional and defaults to DATABASE_URL for migrations. A managed PostgreSQL provider may supply separate pooled/runtime and direct/migration URLs. Preserve TLS certificate verification through the operator's PostgreSQL configuration.

APP_ORIGIN is an HTTPS origin without a path or trailing slash; HTTP is accepted only for localhost development. HOST defaults to loopback; configure it explicitly when another host must reach the standalone listener. TRUST_PROXY is the actual trusted hop count, not a blanket trust setting. Behind a reverse proxy set it to the real hop count: with the default 0 every client shares the proxy address, so five failed logins within 15 minutes lock the owner out for everyone (the throttle is per username and client address).

REPORT_TIMEZONE and PAGE_CHARACTERS are frozen when the instance is first initialized. Changing either later fails rather than recalculating history. See [configuration policy](configuration.md).

## Foundation commands

Run from the repository root against a private development database:

```powershell
node --env-file=.env scripts/migrate.js
node --env-file=.env scripts/setup-owner.js
node --env-file=.env index.js
```

The [Node environment-file option](https://nodejs.org/docs/latest-v22.x/api/cli.html#--env-filefile) loads values relative to the current directory; existing process environment variables take precedence. The application does not load `.env` implicitly. With variables already supplied by the host, the equivalent commands are `npm run migrate`, `npm run setup:owner` and `npm start`.

Migrations are every `db/migrations/NNN_name.sql` file, applied in numeric order (numbers must run 001.. without gaps) transactionally under a PostgreSQL advisory lock. Owner password hashes are stored as `scrypt$N$r$p$salt$hash`; a hash from before cost versioning still verifies and is replaced after the next successful login. Bootstrap requires an interactive private terminal and hides username/password input. The owner password must contain at least 12 characters. Unhandled request failures are logged to stderr as an error name and database code only; never messages, queries or values. It creates a single owner and refuses to replace an existing one. There are no default credentials; this work has not bootstrapped an actual account.

Implemented HTTP routes are login, session refresh, logout, device-token rotation, authenticated device sync configuration, envelope ingestion, durable upload/chunk/commit, source cover upload, private annotation detail/content/cover reads, device status and owner reset. Device credentials cannot use owner routes. A rotated token is returned once through the authenticated owner API; it is not printed in server logs. Report, list, grouping and goal routes are implemented under `/api/v1/owner`. See [API v1](api-v1.md) for the handshake and scopes.

## Provider and container entry points

`server/provider.js` exports a Node HTTP handler without opening a listener. It shares initialization between concurrent requests and permits a later attempt after a transient initialization failure. Provider routing, quotas and deployment still need the I2 setup and separate owner instruction.

Dockerfile and compose.example.yaml are generic examples using external PostgreSQL configuration. They were not built or run; no image was downloaded. The build uses explicit source copies, disables package install scripts and excludes private settings through `.dockerignore`. Container builds and publication remain separate authorized operations, not part of running unit tests.

## Verification boundary

`make check` runs Python harness, contract and server unit gates. `npm run test:server` requires >=80% lines, branches and functions across implemented server JavaScript and included entry/CLI modules. SQL files, PostgreSQL locking/syntax/concurrency, real terminal input, direct CLI process branches, Node 24, containers and provider/device operation are not established by that percentage.

## Allocation implementation assumption (B3 in progress)

The planned Intl-based allocator probes timezone offsets hourly, bisects offset changes and splits constant-offset intervals at local midnight. It assumes IANA offset changes occur on whole seconds and are at least one hour apart. This is a conservative inference from the official Temporal polyfill's offset-search strategy and known shorter search windows of several days, not a complete audit of every timezone transition: [primary implementation](https://github.com/js-temporal/temporal-polyfill/blob/main/lib/ecmascript.ts). Local Node 22.14 reports ICU 76.1 and tzdata 2024b. Other runtime/tzdata versions, including the Node 24 deployment target, remain release acceptance work. Regression tests include a historical rollback with a short-lived local date; this section does not establish complete B3 delivery.
