"""Local unit-test gate. Only this verifier records passing feature evidence."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys


LUA_VERIFIER = Path("tests") / "plugin" / "verify.py"
PLUGIN_GATE = "python -B tests/plugin/verify.py"


def validate_features(items):
    if not isinstance(items, list) or not items:
        raise ValueError("feature_list.json must contain a nonempty list")
    identities = set()
    active = 0
    for item in items:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(key), str) and item[key].strip()
            for key in ("id", "behavior", "state")
        ):
            raise ValueError("Each feature needs nonempty id, behavior and state fields")
        if item["id"] in identities:
            raise ValueError("Feature IDs must be unique")
        identities.add(item["id"])
        if item["state"] not in {"not_started", "active", "blocked", "passing"}:
            raise ValueError("Feature state must be not_started, active, blocked or passing")
        active += item["state"] == "active"
        if "verification" not in item or "evidence" not in item:
            raise ValueError("Each feature needs verification and evidence fields")
        if item["state"] == "passing" and not all(
            isinstance(item[key], str) and item[key].strip()
            for key in ("verification", "evidence")
        ):
            raise ValueError("Passing features require a verification command and evidence")
    if active > 1:
        raise ValueError("At most one feature may be active")


def verify(root):
    registry = root / "feature_list.json"
    items = json.loads(registry.read_text(encoding="utf-8"))
    validate_features(items)
    harness = next((item for item in items if item["id"] == "H01"), None)
    if harness is None:
        raise ValueError("Register the H01 harness gate before verification")
    unit_gates = {"C0": "test:contracts", "B1": "test:server", "B2": "test:server", "B3": "test:server",
                  "F1": "test:panel", "F2": "test:panel"}
    enabled = []
    for identity, script in unit_gates.items():
        item = next((entry for entry in items if entry["id"] == identity), None)
        if item is not None and item["verification"] is not None:
            if item["verification"] != f"npm run {script}":
                raise ValueError(f"{identity} verification must use its implemented unit gate")
            enabled.append((item, script))
    # P1 and P2 share the plugin's Lua gate. Registering one (non-null verification)
    # requires that exact command and the Lua verifier file; promotion still happens
    # only below, after every command succeeded.
    plugin_enabled = []
    for identity in ("P1", "P2"):
        item = next((entry for entry in items if entry["id"] == identity), None)
        if item is not None and item["verification"] is not None:
            if item["verification"] != PLUGIN_GATE:
                raise ValueError(f"{identity} verification must use the plugin Lua gate")
            if not (root / LUA_VERIFIER).is_file():
                raise ValueError(f"{identity} needs tests/plugin/verify.py")
            plugin_enabled.append(item)
    handoff = root / "docs" / "session-handoff.md"
    if len(handoff.read_text(encoding="utf-8").splitlines()) > 70:
        raise ValueError("docs/session-handoff.md must contain at most 70 lines")
    commands = [
        [sys.executable, "-B", "-m", "coverage", "run", "-m", "unittest",
         "discover", "-s", "tests/unit", "-p", "test_*.py"],
        [sys.executable, "-B", "-m", "coverage", "report", "--fail-under=80"],
    ]
    for script in dict.fromkeys(script for _, script in enabled):
        commands.append(["npm.cmd" if sys.platform == "win32" else "npm",
                         "run", script])
    # The plugin's synthetic Lua suite and its 80% per-module line gate run in the
    # same gate. This only protects against regressions: P1 evidence is still
    # written solely by a registered verifier after independent review.
    if (root / LUA_VERIFIER).is_file():
        commands.append([sys.executable, "-B", str(LUA_VERIFIER)])
    elif (root / "projects" / "plugin").is_dir():
        # A renamed or deleted verifier must not silently disable the Lua gate.
        raise ValueError("projects/plugin/ exists but tests/plugin/verify.py is missing")
    commands.append(["git", "diff", "--check"])
    (root / ".local" / "harness").mkdir(parents=True, exist_ok=True)
    temporary = root / ".local" / "tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, "npm_config_cache": str(root / ".local" / "npm-cache"),
                   "TEMP": str(temporary), "TMP": str(temporary),
                   "npm_config_update_notifier": "false"}
    for command in commands:
        subprocess.run(command, cwd=root, check=True, env=environment)
    harness["state"] = "passing"
    harness["verification"] = "make check"
    harness["evidence"] = (
        datetime.now(timezone.utc).isoformat(timespec="seconds")
        + "; make check: unit tests PASS, statement/branch coverage >=80%, git diff --check PASS"
    )
    for item, script in enabled:
        item["state"] = "passing"
        item["evidence"] = (
            datetime.now(timezone.utc).isoformat(timespec="seconds")
            + f"; npm run {script}: unit tests PASS, executable coverage >=80%"
        )
    for item in plugin_enabled:
        item["state"] = "passing"
        item["evidence"] = (
            datetime.now(timezone.utc).isoformat(timespec="seconds")
            + "; tests/plugin/verify.py: synthetic Lua unit tests and differential oracles PASS,"
            " per-module line coverage >=80%; KOReader device, TLS and real server behavior unverified"
        )
    registry.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("ALL CHECKS PASSED (unit tests, coverage >=80%, registry, handoff <=70 lines, diff)")


def main(root):
    try:
        verify(root)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"CHECK FAILED: {type(error).__name__}; fix the failing check and rerun make check.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(__file__).resolve().parents[1]))
