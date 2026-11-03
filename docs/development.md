# Development workflow and environment

Read [AGENTS.md](../AGENTS.md) first. This document holds the detailed operating instructions; product rules, configuration policy, testing guidance and implementation plans are linked below.

## Language

Write and maintain all repository instructions, documentation and plans in English. Translate existing Russian prose without changing technical meaning, identifiers, commands, source URLs, numeric limits, task completion states or historical dates. Keep documentation and plans under `docs/`, with the root harness entry points retained as required by AGENTS.md.

## Scope and planning

- State assumptions and surface material tradeoffs before implementation. Ask when a missing decision prevents a correct implementation.
- Use the smallest implementation that meets the requested behavior. Keep changes surgical and match existing style; avoid unrelated cleanup or speculative abstractions.
- Define verifiable success criteria before coding, run the relevant checks and report limitations honestly.
- Application implementation and local verification were authorized through the updated plan approved on 2026-11-02. External deployment/publication still require a separate owner instruction.
- The approved application team is three agents using `gpt-6.1-terra` with reasoning `high`: backend, KOReader plugin and web panel. Follow the ownership, worktree and coordination rules in the [application plan](superpowers/plans/2026-11-01-kindle-sync.md) when implementing the application.

## Owner machine and downloads

- Do not download programs, runtimes, package dependencies, browser binaries, container images or source/tool distributions without informing the owner and obtaining approval for the concrete download first. Plan approval alone does not approve unannounced downloads.
- Install nothing on C:. Approved tools, dependency/browser/package caches, build outputs and temporary setup files must use an explicitly agreed location on P:.
- Keep global runtimes, package managers, Docker settings and system services unchanged. Existing tools may be inspected/used without installing new ones; ensure commands do not silently bootstrap/download dependencies.
- Browsing official documentation is allowed. Repository clones, Docker pulls, package installation and browser/runtime installation count as downloads under the approval rule.
- Set private P: cache/temp paths before an approved installation; do not rely on default user-profile paths.
- coverage.py 7.16.2 is approved only for this project's ignored `.local/harness-venv`, with cache/temp files under `.local` on P:. See [harness setup](harness.md) for the commands. Routine verification installs nothing.

## Kindle boundary

All copying to the Kindle is performed by the owner. Prepare and review local artifacts/instructions only; do not write, install, update or delete device files. Previously permitted read-only USB inspection is separate from device writes. Record missing hardware observations as open evidence.

## Documentation lookup

For library, framework, SDK, API, CLI or cloud-service setup and usage, fetch current Context7 documentation: resolve the library first, then query the selected ID. Use official primary sources as fallback. Documentation lookup is not required for ordinary business-logic refactoring or review.

## Required references

- [Product requirements](requirements.md): product behavior and accepted scope.
- [Data contract](kindle-sync-data-spec.md): identities, reading accounting, sync and API rules.
- [Configuration and publication policy](configuration.md): private settings/data, portability, staged review, redacted secret scans and intentional Git authorship metadata. Read before configuration changes, commits or publication; preserve every applicable rule.
- [Harness guide](harness.md): unit-only testing, >=80% coverage, registry states, verifier-owned passing evidence and cold-start instructions.
- [Application implementation plan](superpowers/plans/2026-11-01-kindle-sync.md): authorized application work and team coordination. Its older automated E2E/integration test steps are superseded by the owner's unit-only policy.
- [Harness implementation plan](superpowers/plans/2026-11-02-minimal-harness.md): the minimal harness design.
- [Session handoff](session-handoff.md): required when transferring work between agents; at most 70 lines including headings and blank lines.
