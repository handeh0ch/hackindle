# Hackindle

A planned self-hosted reading dashboard and KOReader plugin: highlights, notes with page context, reading history, sessions and a yearly activity calendar.

**Status:** implemented and unit-verified: shared contracts, the server (authentication, sync ingestion, uploads, reports, grouping, goals, backup/restore), the KOReader plugin (capture and durable delivery) and the owner panel (overview, calendar, library, book page, notes, connection). Not verified: anything on a real Kindle, real PostgreSQL with the panel, the container image, and any cloud deployment. Nothing has been deployed or published. See [progress](PROGRESS.md) and the [feature registry](feature_list.json).

The proposed application uses Node.js/Express and standard PostgreSQL. Vercel + Neon is the initial managed deployment; a standalone Node.js/container deployment with another PostgreSQL server is also required. Each installation has its own configuration, owner and device credentials.

## Repository layout

```text
projects/
  plugin/      KOReader plugin (Lua). main.lua, _meta.lua, app.lua at the root; protocol/ time/ reading/ snapshots/
               storage/ text/ delivery/ and koreader/{device,capture}/ hold the modules, required by dotted name
               (protocol.codec). The built plugin stays flat: hackindle_<name>.lua (scripts/build-plugin.js).
  server/      Express API: http/ (app, routes) auth/ infra/ (config, db, migrations, backup) sync/ (device ingestion)
               library/ (owner read model) text/ (Unicode identity)
  frontend/    Owner panel (static): index.html, style.css, js/{core,routes,models,views,lib}/ and js/main.js
contracts/ db/migrations/ scripts/ tests/   shared schemas, SQL, CLI tools and unit tests (unchanged)
index.js app.js                             standalone and Vercel entry points
```

## Documents

- [Product requirements](docs/requirements.md)
- [Configuration and public-repository policy](docs/configuration.md)
- [Data contract draft](docs/hackindle-data-spec.md)
- [API v1 and executable schemas](docs/api-v1.md)
- [Server foundation setup and verification limits](docs/server-setup.md)
- [Approved implementation plan](docs/superpowers/plans/2026-11-01-hackindle.md)
- [Hosting research](docs/hackindle-hosting-research.md)
- [Plugin installation](docs/plugin-install.md)
- [Testing and owner acceptance checklist](docs/testing.md) and [compatibility report template](docs/compatibility-report.md)
- [Deployment and release checks](docs/deployment.md)

`.env.example` defines configuration names and contains empty secrets and generic examples. Actual settings belong in ignored `.env` files or deployment environment/secret storage. Do not commit populated credentials or personal reading data.

The [deployment guide](docs/deployment.md) and the [foundation setup](docs/server-setup.md) describe the migration/bootstrap/start, container and backup commands. Real PostgreSQL with the panel and any deployment have not been exercised; treat the service as not yet deployed.

## Local harness

Run `make check` for harness, contract and server unit tests with blocking 80% coverage thresholds. These do not verify real PostgreSQL, deployment or device compatibility. See [harness setup and coverage scope](docs/harness.md), [current progress](PROGRESS.md) and [feature states](feature_list.json). The checker installs nothing; dependencies are pinned in `requirements-harness.txt` and `package-lock.json`.
