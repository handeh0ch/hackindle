# Kindle Sync

A planned self-hosted reading dashboard and KOReader plugin: highlights, notes with page context, reading history, sessions and a yearly activity calendar.

**Status:** specification and implementation-plan review. The application, plugin and deployment artifacts have not been implemented yet.

The proposed application uses Node.js/Express and standard PostgreSQL. Vercel + Neon is the initial managed deployment; a standalone Node.js/container deployment with another PostgreSQL server is also required. Each installation has its own configuration, owner and device credentials.

## Documents

- [Product requirements](docs/requirements.md)
- [Configuration and public-repository policy](docs/configuration.md)
- [Data contract draft](docs/kindle-sync-data-spec.md)
- [Implementation plan for review](docs/superpowers/plans/2026-11-01-kindle-sync.md)
- [Hosting research](docs/kindle-sync-hosting-research.md)

`.env.example` defines configuration names and contains empty secrets and generic examples. Actual settings belong in ignored `.env` files or deployment environment/secret storage. Do not commit populated credentials or personal reading data.

Runnable installation instructions will be added and verified during implementation. There is no working server to deploy from this documentation-only repository yet.
