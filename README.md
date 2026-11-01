# Kindle Sync

A planned self-hosted reading dashboard and KOReader plugin: highlights, notes with page context, reading history, sessions and a yearly activity calendar.

**Status:** implementation in progress. Shared data contracts and their unit validators are implemented; there is no runnable server, production plugin or panel yet. See [progress](PROGRESS.md) and the [feature registry](feature_list.json).

The proposed application uses Node.js/Express and standard PostgreSQL. Vercel + Neon is the initial managed deployment; a standalone Node.js/container deployment with another PostgreSQL server is also required. Each installation has its own configuration, owner and device credentials.

## Documents

- [Product requirements](docs/requirements.md)
- [Configuration and public-repository policy](docs/configuration.md)
- [Data contract draft](docs/kindle-sync-data-spec.md)
- [API v1 and executable schemas](docs/api-v1.md)
- [Approved implementation plan](docs/superpowers/plans/2026-11-01-kindle-sync.md)
- [Hosting research](docs/kindle-sync-hosting-research.md)

`.env.example` defines configuration names and contains empty secrets and generic examples. Actual settings belong in ignored `.env` files or deployment environment/secret storage. Do not commit populated credentials or personal reading data.

Runnable installation instructions will be added and verified during implementation. There is no working server to deploy from this documentation-only repository yet.

## Local harness

Run `make check` for harness and contract unit tests with blocking 90% coverage thresholds. This does not verify the planned application or device compatibility. See [harness setup and coverage scope](docs/harness.md), [current progress](PROGRESS.md) and [feature states](feature_list.json). The checker installs nothing; dependencies are pinned in `requirements-harness.txt` and `package-lock.json`.
