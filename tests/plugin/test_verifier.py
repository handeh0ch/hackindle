import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('plugin_verify', Path(__file__).with_name('verify.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class CoverageGateTests(unittest.TestCase):
    def test_each_module_must_meet_threshold_even_when_total_passes(self):
        report = 'plugin/a.lua 79 21 79.00%\nplugin/b.lua 999 1 99.90%\n'
        with self.assertRaisesRegex(RuntimeError, 'a.lua'):
            verify.check_coverage(report, {'a.lua', 'b.lua'})

    def test_boundary_and_windows_paths(self):
        report = 'plugin\\a.lua 80 20 80.00%\nplugin\\b.lua 90 0 100.00%\n'
        self.assertEqual(verify.check_coverage(report, {'a.lua', 'b.lua'}), (170, 20))

    def test_missing_duplicate_or_empty_module_fails_closed(self):
        for report in ('plugin/a.lua 80 20 80.00%\n',
                       'plugin/a.lua 80 20 80.00%\nplugin/a.lua 80 20 80.00%\nplugin/b.lua 80 20 80.00%\n',
                       'plugin/a.lua 0 0 0.00%\nplugin/b.lua 80 20 80.00%\n'):
            with self.subTest(report=report), self.assertRaises(RuntimeError):
                verify.check_coverage(report, {'a.lua', 'b.lua'})


if __name__ == '__main__':
    unittest.main()
