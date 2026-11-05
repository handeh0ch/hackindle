"""Run synthetic LuaJIT unit tests with a local, unregistered LuaCov gate."""
from pathlib import Path
import re
import subprocess
import sys

from lupa.luajit21 import LuaRuntime


ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.local' / 'harness'
LUA_COV = ROOT / '.local' / 'tools' / 'luacov-0.17.0' / 'src'


def check_coverage(report, expected):
    rows = re.findall(r'^plugin[\\/](\S+\.lua)\s+(\d+)\s+(\d+)\s+', report, re.MULTILINE)
    observed = {name for name, _, _ in rows}
    missing = sorted(expected - observed)
    if missing:
        raise RuntimeError('LuaCov did not observe plugin modules: ' + ', '.join(missing))
    if not rows or len(rows) != len(observed) or observed != expected:
        raise RuntimeError('LuaCov module summary is invalid')
    for name, hit_text, missed_text in rows:
        hits, missed = int(hit_text), int(missed_text)
        if hits + missed == 0 or hits * 100 < 80 * (hits + missed):
            raise RuntimeError(f'Lua coverage below 80% for {name}: {hits} hit, {missed} missed')
    return sum(int(row[1]) for row in rows), sum(int(row[2]) for row in rows)


def main():
    LOCAL.mkdir(parents=True, exist_ok=True)
    stats = LOCAL / 'p1-luacov.stats'
    report = LOCAL / 'p1-luacov.report'
    stats.unlink(missing_ok=True)
    report.unlink(missing_ok=True)
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.globals().cov_path = str(LUA_COV).replace('\\', '/')
    lua.globals().stats_path = str(stats).replace('\\', '/')
    lua.globals().report_path = str(report).replace('\\', '/')
    lua.execute('''
        package.path = cov_path .. '/?.lua;' .. cov_path .. '/?/init.lua;' .. package.path
        require('jit').off()
        local runner = require('luacov.runner')
        runner.init({statsfile=stats_path, reportfile=report_path, include={'^plugin/'}, exclude={'plugin/unicode_data'}})
        dofile('tests/plugin/run.lua')
        runner.shutdown()
        require('luacov.reporter').report()
    ''')
    expected = {path.name for path in (ROOT / 'plugin').glob('*.lua')} - {'unicode_data.lua'}
    hits, missed = check_coverage(report.read_text(encoding='utf-8'), expected)
    for oracle in ('test_verifier.py', 'allocation_oracle.py', 'validate_projection.py', 'validator_differential.py',
                   'tzif_differential.py', 'tzif_future_oracle.py', 'vocabulary_identity_oracle.py'):
        subprocess.run([sys.executable, '-B', str(ROOT / 'tests' / 'plugin' / oracle)], cwd=ROOT, check=True)
    print(f'Lua coverage: {100 * hits / (hits + missed):.2f}% aggregate ({hits} hit, {missed} missed); each module >=80%')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Lua verification failed: {error}', file=sys.stderr)
        sys.exit(1)
