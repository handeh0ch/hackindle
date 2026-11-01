# Minimal repository harness

This adapts the [Harness_ru quick start](https://github.com/justxor/Harness_ru#%D0%B1%D1%8B%D1%81%D1%82%D1%80%D1%8B%D0%B9-%D1%81%D1%82%D0%B0%D1%80%D1%82-%D0%BC%D0%B8%D0%BD%D0%B8%D0%BC%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9-harness-%D0%B7%D0%B0-30-%D0%BC%D0%B8%D0%BD%D1%83%D1%82): AGENTS.md, feature_list.json, PROGRESS.md and one verification command. The owner's unit-only testing policy replaces the example E2E gate.

## Run

From the repository root on Windows:

```powershell
make check
```

Without Make, the same gate is:

```powershell
& .local/harness-venv/Scripts/python.exe -B scripts/check.py
```

Existing Python 3.13 and GNU Make are used. The project-only environment contains pinned coverage.py from `requirements-harness.txt`. The checker never installs dependencies. A missing interpreter or coverage module fails the command.

For a fresh checkout, obtain the owner's approval before downloading the pinned dependency and agree a location on P:. The following setup uses only this project's ignored paths; do not run it from a checkout on C:.

```powershell
New-Item -ItemType Directory -Force -Path .local/tmp,.local/pip-cache | Out-Null
$env:TEMP = Join-Path (Get-Location) '.local/tmp'
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = Join-Path (Get-Location) '.local/pip-cache'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -B -m venv .local/harness-venv
if ($LASTEXITCODE -ne 0) { throw 'Could not create the project environment' }
& .local/harness-venv/Scripts/python.exe -B -m pip install --disable-pip-version-check -r requirements-harness.txt
if ($LASTEXITCODE -ne 0) { throw 'Could not install harness dependencies' }
```

On other systems use an existing approved environment and override `make check PYTHON=/path/to/python`; paths containing spaces are supported. No package manager runs during verification.

## Gate and coverage scope

The checker validates feature states and WIP=1, requires [session-handoff.md](session-handoff.md) to exist with at most 70 lines including headings and blank lines, runs unittest discovery in `tests/unit`, enforces coverage.py's combined statement/branch threshold of 90%, runs the registered contract unit gate, and runs `git diff --check`. Unit tests isolate subprocess boundaries; they do not start an application, database, network service or device. Python coverage data is in `.local/harness/.coverage`. Child processes receive project-local `.local/npm-cache` and `.local/tmp` settings; the checker never changes global settings or installs dependencies.

Before transferring work between agents, update the handoff in place. Keep it short by linking to current specifications, plans and evidence. The receiving agent reads AGENTS.md, then the handoff, and checks Git status; PROGRESS.md and feature_list.json remain the authoritative work/evidence records.

`git diff --check` checks unstaged changes to tracked files; staged changes and untracked new files are outside this whitespace check. It is not a repository-wide linter.

Python coverage includes all source under `scripts/`, including unexecuted files. It excludes tests, dependencies, and the pre-existing standalone prototype generator/diagnostic, which is separate investigatory tooling. This percentage proves coverage of the harness only.

`npm run test:contracts` uses the existing Node.js built-in unit runner and V8 coverage. It requires >=90% lines, branches and functions for executable JavaScript under `contracts/`; the current module is `validate.js`. Node measures loaded modules, so new executable contract modules must be imported by the suite. JSON schemas/examples have acceptance/rejection tests but no executable statement coverage. Native Node 22.14 may emit an experimental glob warning; Node 24 remains unverified. This gate certifies neither application behavior nor device extraction. There are no automated integration/E2E/browser/device suites.

The pinned contract dependencies are Ajv 8.17.1 and ajv-formats 3.0.1 plus their locked transitive dependencies. For a fresh checkout, obtain concrete download approval before `npm ci --ignore-scripts --no-audit --no-fund --cache .local/npm-cache` and set TEMP/TMP to `.local/tmp` on the agreed P: checkout. The checker only runs installed packages; it never invokes an install command.

Only after every command succeeds does the checker write H01 `passing` and timestamped evidence to `feature_list.json`. Reviewed feature gates are fixed in the checker: C0 uses `npm run test:contracts`; B1 uses `npm run test:server`. Enabled commands run before the diff check; their feature evidence is recorded only after the whole gate succeeds. A null verifier leaves a feature unpromoted; an unknown command is rejected before any subprocess runs. Registry text is never executed as an arbitrary shell command. A failure returns nonzero and leaves the registry untouched, including when the server gate fails after contracts pass. Evidence describes the last successful run, not a guarantee about later changes: rerun `make check` before claiming completion. State is repository memory, not a tamper-proof security boundary.

The four states are `not_started`, `active`, `blocked`, `passing`; at most one is active. An unimplemented or not-yet-reviewed feature gate is `null`, never a made-up executable command. C0 was registered after review and passed the combined gate. For each later feature, implement its unit verifier and coverage check before allowing a verifier to promote it. Agents may edit work descriptions and unfinished states, but must not manually write `passing` or successful evidence.

The green gate does not certify KOReader hardware behavior, an entire application, deployment readiness or secret-free Git history. Existing release/privacy requirements still apply. The application implementation plan now reflects the owner's unit-only clarification and deferred manual Kindle checks. Hardware observations remain an owner activity, recorded honestly.

## Cold-start answers

1. **What and why?** Kindle Sync archives one owner's KOReader notes/context and reading history for a self-hosted dashboard. See README and product requirements.
2. **How to start?** No application is implemented. Run the local harness as above; the separate diagnostic has its own README and requires owner actions for device observations.
3. **How to verify?** `make check`: unit tests plus >=90% harness coverage, registry validation and diff checks. No application linter/type checker is configured yet.
4. **Hard rules?** AGENTS.md: explicit download approval, all installs/caches on P:, owner-only device writes, private credentials/data outside Git, portable validated configuration, and separate publication authorization.
5. **Where is work now?** PROGRESS.md and feature_list.json record H01 and the current feature. C0 proceeds with explicit unverified adapter assumptions; the owner deferred remaining manual Kindle observations until the application is assembled.

An independent cold-start evaluation must read those files without prior chat context; this answer map alone is not evidence that such an evaluation took place.

On 2026-11-02 an independent read-only reviewer without chat history answered all five questions from repository files and found no missing-answer gap.
