"""Local unit-test gate. Only this verifier records passing feature evidence."""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys


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
    commands = [
        [sys.executable, "-B", "-m", "coverage", "run", "-m", "unittest",
         "discover", "-s", "tests/unit", "-p", "test_*.py"],
        [sys.executable, "-B", "-m", "coverage", "report", "--fail-under=90"],
        ["git", "diff", "--check"],
    ]
    (root / ".local" / "harness").mkdir(parents=True, exist_ok=True)
    for command in commands:
        subprocess.run(command, cwd=root, check=True)
    harness["state"] = "passing"
    harness["verification"] = "make check"
    harness["evidence"] = (
        datetime.now(timezone.utc).isoformat(timespec="seconds")
        + "; make check: unit tests PASS, statement/branch coverage >=90%, git diff --check PASS"
    )
    registry.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("ALL CHECKS PASSED (unit tests, coverage >=90%, registry, diff)")


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
