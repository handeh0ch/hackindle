# Minimal harness implementation plan

**Goal:** Apply the four-file quick start from [Harness_ru](https://github.com/justxor/Harness_ru#%D0%B1%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9-%D1%81%D1%82%D0%B0%D1%80%D1%82-%D0%BC%D0%B8%D0%BD%D0%B8%D0%BC%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9-harness-%D0%B7%D0%B0-30-%D0%BC%D0%B8%D0%BD%D1%83%D1%82) to this repository.

**Design:** Keep the existing project constraints in AGENTS.md. Add a feature registry, handoff state and one local verification command. Use the existing Python and Make; coverage.py 7.16.2 is approved for a project-only environment on P:. No application implementation or publication is included.

**Testing policy:** The owner's 2026-11-02 clarification requires unit tests only, with a blocking coverage threshold of 90%. This supersedes the article's example E2E gate. Coverage initially measures harness Python source only; no application source exists yet. The existing device diagnostic remains separate.

## Files and verification

- AGENTS.md: project purpose, commands, completion rules and context pointers.
- feature_list.json: H01 for this harness, plus the approved application work items. Unimplemented work has no executable verifier yet and cannot become passing.
- PROGRESS.md: current baseline, blockers, decisions and next action.
- Makefile, .coveragerc, requirements-harness.txt: one command, pinned project dependency, branch coverage >=90%, local output paths.
- scripts/check.py: validate registry, run unit tests/coverage/diff checks, then record H01 evidence. Failed checks leave the registry untouched.
- tests/unit/test_harness.py: malformed states, duplicate IDs, WIP limit, missing evidence, failed tools and successful promotion.
- docs/harness.md and README.md: setup, coverage scope and cold-start answers.

## Execution

1. Write unit tests and observe failure before implementing the checker.
2. Implement the smallest gate; run it with installed project tooling.
3. Demonstrate rejection of failed tests and insufficient coverage through unit tests of tool boundaries; run the real coverage gate.
4. Review all changed files and answer the five cold-start questions from repository files.

## Success criteria

`make check` runs only unit tests, fails below 90% statement/branch coverage and records passing evidence only after all checks succeed. Application/device acceptance stays open. No downloads beyond the approved project dependency; no Kindle writes, commits or publication.
