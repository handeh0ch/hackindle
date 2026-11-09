# Configuration, portability and publication

Status: required deployment contract for implementation. Files shown as future deliverables are not working application features yet.

## Configuration boundaries

The same Express application runs on a standalone Node.js server/container or through the Vercel adapter. It uses standard PostgreSQL SQL and migrations through `pg`. A Neon deployment supplies its connection string; another PostgreSQL deployment supplies its own. Core business logic does not call Neon/Vercel management APIs or require their account IDs.

- `projects/server/infra/config.js` loads/validates server settings once; core modules receive parsed configuration and database dependencies. No scattered reads of provider-specific environment variables.
- `projects/server/http/app.js` exports `createApp({db,config})`. A standalone entry opens HOST/PORT; a Vercel entry exports the handler and owns any platform lifecycle integration.
- Panel API URLs are relative to the current origin. All files under projects/frontend/** are public; server settings and secrets are never bundled into JavaScript or generated HTML.
- Plugin URL/token are set on the device and stored under KOReader's private settings, not inside the shipped plugin source. Device credentials and the nonsecret sync profile identify the installation.
- The sync profile supplies instance identity, reporting timezone, page-character denominator and protocol/transport limits through an authenticated device endpoint. It contains no DB credentials or owner data. Client/server timestamps are UTC.

## Variables

`.env.example` is the canonical template. It contains empty secret slots and generic defaults, not a working configuration of the owner's installation.

| Variable | Purpose | Visibility and rules |
| --- | --- | --- |
| DATABASE_URL | Runtime PostgreSQL connection | Secret; supplied privately. Pooled URL is appropriate for managed serverless hosting |
| DIRECT_DATABASE_URL | Migration connection | Secret; provided to migration tooling, not browser/plugin. A normal PostgreSQL installation may use the same endpoint as runtime |
| APP_ORIGIN | Canonical external origin | Operator-supplied HTTPS origin for cookies/Origin checks; local development may explicitly use HTTP localhost |
| REPORT_TIMEZONE | IANA timezone for reporting days | Generic template uses UTC. The real installation value stays private |
| PAGE_CHARACTERS | Conditional-page denominator | Default 2000; positive integer, part of the initialized measurement policy |
| HOST / PORT | Standalone listener | Generic defaults; Vercel's handler does not listen on these |
| TRUST_PROXY | Trusted proxy hop count | Default 0; operator sets the actual reverse-proxy topology. Never blindly trust arbitrary forwarded headers |

Validate required fields at startup; report variable names without printing values. Production requires an HTTPS origin. Validate PostgreSQL TLS using the selected deployment's connection configuration; do not disable certificate verification globally.

On first initialization, persist the instance ID and measurement policy. If REPORT_TIMEZONE or PAGE_CHARACTERS later disagree with that policy, fail clearly instead of silently recalculating historical numbers. Changing the policy requires an explicit migration/new measurement series; substituting a different operator's initial settings is supported.

Owner passwords are entered during private bootstrap and stored as salted password hashes in PostgreSQL. Generate device/session secrets per installation and store only their hashes server-side; display a newly created device token once. There is no built-in owner account, default password or shared device token.

## Deployment deliverables

1. Vercel + Neon guide: private environment settings, direct migration URL, owner bootstrap, HTTPS and independent staging credentials.
2. Standalone guide: Node.js start command, migrations, bootstrap, trusted reverse proxy/TLS, process restart and backup/restore. An ordinary PostgreSQL server is sufficient.
3. Dockerfile and compose example using environment/secret injection, with an optional local PostgreSQL service. Container builds exclude local env files, credentials, books and reading data through .dockerignore and explicit COPY paths.
4. Both deployment modes execute the same application/DB tests. Verify a deployment with generic URLs and a timezone different from the original owner's, without source edits. Document the tested PostgreSQL/runtime versions.

The program may require Node.js, PostgreSQL and KOReader as selected technologies. Portability means changing instances/providers through configuration; it does not require maintaining multiple unrelated database engines or a generic hosting framework.

## Public Git and release checks

- Keep actual instance values in ignored .env/private files or the host's environment/secret storage. Keep plugin local settings outside the plugin distribution. Commit only .env.example with empty secrets and reserved example domains.
- Inspect staged paths and diff before every commit. Ignore rules do not protect already tracked files, copied values in docs or values in history.
- Add a redacted secret scan of the entire reachable Git history to release checks/CI before publication. Install the scanner from a verified official release; a local staged-file check is useful in addition, not a substitute for history scanning.
- Validate .env/.env.production, nested env files, keys, dumps, exported notes, plugin local state and personal books are ignored. Validate the empty example template and SQL migrations remain trackable.
- Commit only synthetic fixtures generated for testing. Sanitize screenshots, errors and deployment logs; configuration validation logs names only.
- Before packaging, inspect the built image and plugin archive for populated env/config files, credentials, dumps and reading data.
- If credentials were committed, rotate/revoke them and clean history before publication. Removing the current file alone is insufficient. Arrange history rewriting explicitly, and do not expose the secret in the report.
- Public Git author email is separate from application credentials. The owner has chosen to retain their existing authorship metadata; no history rewrite is currently requested.

The current documentation-only repository was checked locally with the official Gitleaks 8.30.1 binary after verifying its archive SHA-256 against the release checksums. Re-run both checks for future changes; this result is not a guarantee that later edits are safe:

```sh
gitleaks git --redact --log-opts="--all" .
gitleaks git --staged --redact .
```

The installed scanner and any local audit output stay in ignored local tooling directories. CI enforcement and image/archive scanning remain implementation-plan tasks; they are not already enabled by this document. [Official Gitleaks usage](https://github.com/gitleaks/gitleaks).

No remote repository, deployment, cloud account or paid option is created by these documents.
