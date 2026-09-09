"""Process-level entrypoint checks without Django, Docker, or a database."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


ENTRYPOINT = Path(__file__).resolve().parents[1] / 'entrypoint.sh'


class EntrypointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.log = self.root / 'calls'
        self.env = {
            **os.environ,
            'PATH': f'{self.root}:{os.environ["PATH"]}',
            'DB_HOST': '',
            'DJANGO_SETTINGS_MODULE': 'core.settings.prod',
            'RUN_MIGRATIONS': 'true',
            'RUN_COLLECTSTATIC': 'true',
            'CALL_LOG': str(self.log),
        }
        python = self.root / 'python'
        python.write_text(
            f'#!{sys.executable}\n'
            'import os, sys\n'
            'if sys.argv[1] == "-":\n'
            f'    os.execv({sys.executable!r}, [{sys.executable!r}, *sys.argv[1:]])\n'
            'with open(os.environ["CALL_LOG"], "a") as log:\n'
            '    log.write(" ".join(sys.argv[1:]) + "\\n")\n'
            'sys.exit(int(os.environ.get("MANAGEMENT_EXIT", "0")))\n'
        )
        python.chmod(0o755)
        for name in ('server', 'celery'):
            command = self.root / name
            command.write_text('#!/bin/sh\nprintf "%s\\n" "exec $*" >> "$CALL_LOG"\n')
            command.chmod(0o755)
        (self.root / 'manage.py').write_text(
            'import os, sys, time\n'
            'time.sleep(float(os.environ.get("CHECK_DELAY", "0")))\n'
            'sys.exit(int(os.environ.get("CHECK_EXIT", "0")))\n'
        )

    def run_entrypoint(self, *args, **env):
        return subprocess.run(
            ['sh', str(ENTRYPOINT), *args], cwd=self.root,
            env={**self.env, **env}, capture_output=True, text=True, timeout=5,
        )

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_legacy_production_migrates_collects_and_executes(self):
        result = self.run_entrypoint('server', 'two words')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [
            'manage.py migrate --noinput', 'manage.py collectstatic --noinput',
            'exec two words',
        ])

    def test_deployment_skips_implicit_management_commands(self):
        result = self.run_entrypoint('server', RUN_MIGRATIONS='false', RUN_COLLECTSTATIC='false')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ['exec '])

    def test_explicit_migration_runs_once(self):
        result = self.run_entrypoint(
            'python', 'manage.py', 'migrate', '--noinput',
            RUN_MIGRATIONS='false', RUN_COLLECTSTATIC='false',
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ['manage.py migrate --noinput'])

    def test_failed_implicit_migration_does_not_start_server(self):
        result = self.run_entrypoint('server', MANAGEMENT_EXIT='2')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), ['manage.py migrate --noinput'])

    def test_worker_never_migrates_or_collects(self):
        result = self.run_entrypoint('celery', '-A', 'core', 'worker')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ['exec -A core worker'])

    def test_beat_starts_after_schema_check(self):
        result = self.run_entrypoint('celery', '-A', 'core', 'beat')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ['exec -A core beat'])

    def test_failed_schema_check_times_out_without_starting_beat(self):
        result = self.run_entrypoint(
            'celery', '-A', 'core', 'beat',
            CHECK_EXIT='1', MIGRATION_WAIT_TIMEOUT='0.1',
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Migration readiness timed out', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_hung_schema_check_is_bounded(self):
        result = self.run_entrypoint(
            'celery', '-A', 'core', 'beat',
            CHECK_DELAY='10', MIGRATION_WAIT_TIMEOUT='0.1',
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Migration readiness timed out', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_database_wait_times_out(self):
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            result = self.run_entrypoint(
                'server', DB_HOST='127.0.0.1',
                DB_PORT=str(reserved.getsockname()[1]), DB_WAIT_TIMEOUT='0.1',
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Database readiness timed out', result.stderr)
        self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()
