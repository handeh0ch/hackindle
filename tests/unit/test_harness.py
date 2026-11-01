import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scripts.check import main, validate_features, verify


def feature(identity="H01", state="active"):
    return {"id": identity, "behavior": "Synthetic behavior", "verification": "make check",
            "state": state, "evidence": None}


class RegistryTests(unittest.TestCase):
    def test_accepts_four_states_and_unimplemented_work(self):
        items = [feature(str(i), state) for i, state in enumerate(
            ["not_started", "active", "blocked", "passing"])]
        items[0]["verification"] = None
        items[3]["evidence"] = "previous verified run"
        validate_features(items)

    def test_rejects_invalid_registry_without_echoing_values(self):
        for items in ([], {}, [feature(state="secret-invalid-state")],
                      [feature(), feature()], [feature(), feature("C0")],
                      [feature(state="passing")]):
            with self.subTest(items=items), self.assertRaises(ValueError) as error:
                validate_features(items)
            self.assertNotIn("secret-invalid-state", str(error.exception))

    def test_requires_behavior_id_and_verification_for_passing(self):
        for key in ("id", "behavior", "verification"):
            item = feature(state="passing")
            item["evidence"] = "previous verified run"
            item[key] = None
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_features([item])

    def test_requires_explicit_verification_and_evidence_fields(self):
        for key in ("verification", "evidence"):
            item = feature()
            del item[key]
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_features([item])


class GateTests(unittest.TestCase):
    def setUp(self):
        temporary = Path(__file__).resolve().parents[2] / ".local" / "tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=temporary)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "docs").mkdir()
        self.handoff = self.root / "docs" / "session-handoff.md"
        self.handoff.write_text("# Session handoff\n", encoding="utf-8")
        self.items = [feature(), feature("P0", "blocked")]
        self.items[1]["verification"] = None
        self.registry = self.root / "feature_list.json"
        self.registry.write_text(json.dumps(self.items), encoding="utf-8")

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run")
    def test_success_records_only_registered_implemented_gate(self, run, output):
        verify(self.root)
        saved = json.loads(self.registry.read_text(encoding="utf-8"))
        self.assertEqual(saved[0]["state"], "passing")
        self.assertIn("make check", saved[0]["evidence"])
        self.assertIn("90%", saved[0]["evidence"])
        self.assertEqual(saved[1], self.items[1])
        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn("unittest", commands[0])
        self.assertIn("report", commands[1])
        self.assertIn("--fail-under=90", commands[1])
        self.assertEqual(commands[2], ["git", "diff", "--check"])
        for call in run.call_args_list:
            self.assertTrue(call.kwargs["check"])
            self.assertEqual(call.kwargs["cwd"], self.root)

    @patch("scripts.check.subprocess.run")
    def test_failed_tests_coverage_or_diff_never_record_passing(self, run):
        original = self.registry.read_bytes()
        for failed_step in range(3):
            run.reset_mock()
            run.side_effect = [None] * failed_step + [subprocess.CalledProcessError(1, "gate")]
            with self.subTest(step=failed_step), self.assertRaises(subprocess.CalledProcessError):
                verify(self.root)
            self.assertEqual(self.registry.read_bytes(), original)
            self.assertEqual(run.call_count, failed_step + 1)

    @patch("scripts.check.subprocess.run")
    def test_missing_harness_gate_fails_before_tools(self, run):
        self.registry.write_text(json.dumps([feature("P0", "blocked")]), encoding="utf-8")
        with self.assertRaises(ValueError):
            verify(self.root)
        run.assert_not_called()

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run")
    def test_main_returns_success_after_checks(self, run, output):
        self.assertEqual(main(self.root), 0)

    @patch("builtins.print")
    def test_main_returns_failure_without_leaking_invalid_values(self, output):
        self.registry.write_text("secret-invalid-json", encoding="utf-8")
        self.assertEqual(main(self.root), 1)
        self.assertIn("CHECK FAILED", output.call_args.args[0])
        self.assertNotIn("secret-invalid-json", output.call_args.args[0])

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run", side_effect=FileNotFoundError("private-path"))
    def test_main_handles_missing_tools_without_promoting(self, run, output):
        original = self.registry.read_bytes()
        self.assertEqual(main(self.root), 1)
        self.assertEqual(self.registry.read_bytes(), original)
        self.assertNotIn("private-path", output.call_args.args[0])

    @patch("scripts.check.subprocess.run")
    def test_invalid_registry_fails_before_tools(self, run):
        self.registry.write_text("not json", encoding="utf-8")
        with self.assertRaises(ValueError):
            verify(self.root)
        run.assert_not_called()

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run")
    def test_accepts_handoff_at_seventy_line_limit(self, run, output):
        self.handoff.write_text("Synthetic context\n" * 70, encoding="utf-8")
        verify(self.root)
        self.assertEqual(json.loads(self.registry.read_text(encoding="utf-8"))[0]["state"], "passing")

    @patch("scripts.check.subprocess.run")
    def test_rejects_handoff_over_seventy_lines_before_tools(self, run):
        self.handoff.write_text("\n" * 71, encoding="utf-8")
        original = self.registry.read_bytes()
        with self.assertRaisesRegex(ValueError, "70 lines"):
            verify(self.root)
        run.assert_not_called()
        self.assertEqual(self.registry.read_bytes(), original)

    @patch("scripts.check.subprocess.run")
    def test_requires_handoff_file(self, run):
        self.handoff.unlink()
        with self.assertRaises(FileNotFoundError):
            verify(self.root)
        run.assert_not_called()

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run")
    def test_registered_contract_gate_runs_before_diff_and_records_evidence(self, run, output):
        contract = feature("C0")
        contract["verification"] = "npm run test:contracts"
        self.items[0]["state"] = "passing"
        self.items[0]["evidence"] = "previous run"
        self.registry.write_text(json.dumps(self.items + [contract]), encoding="utf-8")
        verify(self.root)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(commands[2][1:], ["run", "test:contracts"])
        self.assertIn(commands[2][0], {"npm", "npm.cmd"})
        self.assertEqual(commands[3], ["git", "diff", "--check"])
        saved = json.loads(self.registry.read_text(encoding="utf-8"))
        self.assertEqual(saved[-1]["state"], "passing")
        self.assertIn("npm run test:contracts", saved[-1]["evidence"])
        self.assertEqual(saved[1], self.items[1])

    @patch("scripts.check.subprocess.run")
    def test_contract_failure_does_not_promote_any_feature(self, run):
        contract = feature("C0")
        contract["verification"] = "npm run test:contracts"
        self.items[0]["state"] = "passing"
        self.items[0]["evidence"] = "previous run"
        self.registry.write_text(json.dumps(self.items + [contract]), encoding="utf-8")
        original = self.registry.read_bytes()
        run.side_effect = [None, None, subprocess.CalledProcessError(1, "contract unit gate")]
        with self.assertRaises(subprocess.CalledProcessError):
            verify(self.root)
        self.assertEqual(self.registry.read_bytes(), original)
        self.assertEqual(run.call_count, 3)

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run")
    def test_unimplemented_contract_gate_stays_active(self, run, output):
        contract = feature("C0")
        contract["verification"] = None
        self.items[0]["state"] = "passing"
        self.items[0]["evidence"] = "previous run"
        self.registry.write_text(json.dumps(self.items + [contract]), encoding="utf-8")
        verify(self.root)
        self.assertEqual(run.call_count, 3)
        self.assertEqual(json.loads(self.registry.read_text(encoding="utf-8"))[-1], contract)

    @patch("scripts.check.subprocess.run")
    def test_unknown_contract_verifier_fails_without_running_registry_command(self, run):
        contract = feature("C0", "not_started")
        contract["verification"] = "untrusted-command"
        self.registry.write_text(json.dumps(self.items + [contract]), encoding="utf-8")
        with self.assertRaises(ValueError):
            verify(self.root)
        run.assert_not_called()

    @patch("builtins.print")
    @patch("scripts.check.subprocess.run")
    def test_verification_keeps_npm_cache_and_temporary_files_inside_checkout(self, run, output):
        verify(self.root)
        for call in run.call_args_list:
            environment = call.kwargs.get("env", {})
            self.assertEqual(environment.get("npm_config_cache"),
                             str(self.root / ".local" / "npm-cache"))
            self.assertEqual(environment.get("TEMP"), str(self.root / ".local" / "tmp"))
            self.assertEqual(environment.get("TMP"), str(self.root / ".local" / "tmp"))
