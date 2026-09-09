"""Exercise the public bootstrap CLI against disposable copies of this template."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


REPOSITORY = Path(__file__).resolve().parents[2]
EXCLUDED = shutil.ignore_patterns(
    '.git', '.omc', '__pycache__', '*.pyc', 'node_modules', '.next', '.venv',
    'venv', 'media', 'staticfiles', '*.sqlite3', '.env', '.env.dev', '.env.prod',
    '.bootstrap.json', '.bootstrap-journal',
)


def copy_template(destination):
    for name in ('backend', 'frontend', 'scripts', 'caddy', 'observability', 'docs'):
        shutil.copytree(REPOSITORY / name, destination / name, ignore=EXCLUDED)
    for name in ('Makefile', 'README.md', 'AGENTS.md', '.gitignore', '.env.example',
                 '.env.prod.example', 'docker-compose.yml', 'docker-compose.prod.yml'):
        if (REPOSITORY / name).is_file():
            shutil.copy2(REPOSITORY / name, destination / name)


def snapshot(root):
    result = {}
    for path in root.rglob('*'):
        if '.git' in path.relative_to(root).parts or '__pycache__' in path.parts:
            continue
        if path.is_symlink():
            result[str(path.relative_to(root))] = ('link', os.readlink(path))
        elif path.is_file():
            result[str(path.relative_to(root))] = (
                stat.S_IMODE(path.stat().st_mode), hashlib.sha256(path.read_bytes()).hexdigest())
        elif path.is_dir():
            result[str(path.relative_to(root))] = ('directory',)
    return result


def env_values(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if line and not line.startswith('#') and '=' in line)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='saas-init-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        copy_template(self.root)

    def cli(self, *args, success=True):
        result = subprocess.run(
            [sys.executable, '-B', str(self.root / 'scripts/init_project.py'), *args],
            cwd=self.root, stdin=subprocess.DEVNULL, capture_output=True, text=True,
            timeout=30,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def initialize(self, **overrides):
        fields = dict(name='Acme', domain='acme.com', package='acme', database='acme')
        fields.update(overrides)
        args = [value for key, value in fields.items() for value in (f'--{key}', value)]
        return self.cli(*args, '--yes')

    def test_dry_run_is_byte_and_path_preserving(self):
        before = snapshot(self.root)
        self.cli('--name', 'Acme', '--domain', 'acme.com', '--package', 'acme',
                 '--database', 'acme', '--dry-run')
        self.assertEqual(before, snapshot(self.root))

    def test_rename_configuration_and_contract_metadata(self):
        original_contract = json.loads((self.root / 'backend/openapi.json').read_text())
        original_lock = json.loads((self.root / 'frontend/package-lock.json').read_text())
        output = self.initialize()
        self.assertFalse((self.root / 'backend/core').exists())
        self.assertTrue((self.root / 'backend/acme/settings/base.py').is_file())
        for path in (self.root / 'backend').rglob('*.py'):
            source = path.read_text()
            ast.parse(source, filename=str(path))
            self.assertNotIn('from core ', source, str(path))
            self.assertNotIn('from core.', source, str(path))
            self.assertNotIn('core.settings.', source, str(path))
        settings = (self.root / 'backend/acme/settings/base.py').read_text()
        self.assertIn('django.core.', settings)
        self.assertIn('acme.urls', settings)
        self.assertIn('acme.settings.prod', (self.root / 'backend/entrypoint.sh').read_text())
        self.assertIn('acme.settings.schema', (self.root / 'scripts/api-contract.sh').read_text())
        trace_script = (self.root / 'scripts/check-observability-trace.py').read_text()
        self.assertNotIn('from core.', trace_script)
        self.assertNotIn('backend/core', trace_script)
        self.assertIn('acme-smoke-backend-', trace_script)
        vault = self.root / 'frontend/src/lib/auth-vault.ts'
        if vault.exists():
            self.assertNotIn('mobser:', vault.read_text())
        self.assertIn('celery -A acme', (self.root / 'docker-compose.yml').read_text())
        self.assertNotIn('container_name: starter', (self.root / 'docker-compose.yml').read_text())
        package = json.loads((self.root / 'frontend/package.json').read_text())
        lock = json.loads((self.root / 'frontend/package-lock.json').read_text())
        self.assertEqual(package['name'], 'acme-frontend')
        self.assertEqual(lock['name'], package['name'])
        self.assertEqual(lock['packages']['']['name'], package['name'])
        lock['name'] = original_lock['name']
        lock['packages']['']['name'] = original_lock['packages']['']['name']
        self.assertEqual(lock, original_lock)
        contract = json.loads((self.root / 'backend/openapi.json').read_text())
        self.assertIn('Acme', contract['info']['title'])
        contract['info'] = original_contract['info']
        self.assertEqual(contract, original_contract)
        dev = env_values(self.root / '.env')
        prod = env_values(self.root / '.env.prod')
        self.assertEqual(dev['DB_NAME'], 'acme')
        self.assertEqual(prod['DB_NAME'], 'acme')
        self.assertEqual(prod['DOMAIN_NAME'], 'acme.com')
        self.assertEqual(prod['NEXTAUTH_URL'], 'https://acme.com')
        self.assertEqual(prod['NEXT_PUBLIC_API_URL'], 'https://acme.com/api')
        self.assertEqual(prod['CORS_ALLOWED_ORIGINS'], 'https://acme.com')
        self.assertEqual(prod['CSRF_TRUSTED_ORIGINS'], 'https://acme.com')
        self.assertEqual(dev['NEXTAUTH_URL'], 'http://localhost')
        self.assertEqual(dev['BACKEND_API_URL'], prod['BACKEND_API_URL'])
        for key in ('SECRET_KEY', 'OTP_SECRET', 'NEXTAUTH_SECRET', 'DB_PASSWORD',
                    'RATE_LIMIT_PROXY_TOKEN', 'RATE_LIMIT_KEY_SECRET'):
            self.assertGreaterEqual(len(dev[key]), 32)
            self.assertGreaterEqual(len(prod[key]), 32)
            self.assertNotEqual(dev[key], prod[key])
            for value in (dev[key], prod[key]):
                self.assertNotIn(value, output.stdout + output.stderr)
                self.assertNotIn(value, (self.root / '.bootstrap.json').read_text())
                self.assertNotIn(value, (self.root / '.env.example').read_text())
                self.assertNotIn(value, (self.root / '.env.prod.example').read_text())
        if os.name == 'posix':
            self.assertEqual(stat.S_IMODE((self.root / '.env').stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((self.root / '.env.prod').stat().st_mode), 0o600)
        self.assertFalse((self.root / '.bootstrap-journal').exists())

    def test_keep_core_and_reruns_preserve_secrets(self):
        self.initialize(package='core')
        self.assertTrue((self.root / 'backend/core').is_dir())
        before = snapshot(self.root)
        self.cli()
        self.initialize(package='core')
        self.assertEqual(before, snapshot(self.root))
        self.cli('--name', 'Other', '--domain', 'other.com', '--package', 'other',
                 '--database', 'other', '--yes', success=False)
        self.assertEqual(before, snapshot(self.root))

    def test_unusual_display_name_and_hyphen_slug(self):
        display_name = 'O\'Reilly "Research" & Sons'
        self.initialize(name=display_name, slug='oreilly-tools',
                        package='oreilly_tools', database='oreilly_db')
        for path in (self.root / 'backend').rglob('*.py'):
            ast.parse(path.read_text(), filename=str(path))
        dashboard = json.loads((self.root / 'observability/grafana/dashboards/oreilly-tools.json').read_text())
        self.assertIn(display_name, dashboard['title'])
        self.assertIn('oreilly_tools_http_requests', json.dumps(dashboard))
        self.assertIn('oreilly_tools.http.requests',
                      (self.root / 'backend/oreilly_tools/telemetry.py').read_text())
        self.assertIn('oreilly-tools-frontend', (self.root / 'frontend/package.json').read_text())
        if shutil.which('make'):
            help_output = subprocess.run(['make', 'help'], cwd=self.root, capture_output=True,
                                         text=True, timeout=10, check=True)
            self.assertIn(display_name, help_output.stdout)

    def test_invalid_fields_do_not_write(self):
        valid = dict(name='Acme', domain='acme.com', package='acme', database='acme')
        before = snapshot(self.root)
        invalid = (
            ('name', 'bad\nname'), ('name', '$(touch injected)'),
            ('domain', 'https://acme.com'), ('domain', 'acme.com/path'),
            ('domain', 'acme.com:443'), ('domain', 'a b.com'),
            ('package', 'class'), ('package', 'json'), ('package', '../oops'),
            ('package', 'redis'), ('package', 'requests'), ('package', 'jwt'),
            ('package', 'apps'), ('database', 'bad-name'), ('database', 'a' * 64),
            ('slug', '../oops'),
        )
        for field, value in invalid:
            with self.subTest(field=field, value=value):
                fields = {**valid, field: value}
                args = [item for k, v in fields.items() for item in (f'--{k}', v)]
                self.cli(*args, '--yes', success=False)
                self.assertEqual(before, snapshot(self.root))

    def test_noninteractive_requires_values_and_yes(self):
        before = snapshot(self.root)
        self.cli(success=False)
        self.cli('--name', 'Acme', '--domain', 'acme.com', '--package', 'acme',
                 '--database', 'acme', success=False)
        self.assertEqual(before, snapshot(self.root))

    @unittest.skipUnless(os.name == 'posix' and shutil.which('make'), 'requires Make and a PTY')
    def test_make_interactive_cancel_then_initialize(self):
        import pty

        def interactive(answers):
            master, slave = pty.openpty()
            process = subprocess.Popen(
                ['make', 'init', f'PYTHON={sys.executable}'], cwd=self.root,
                stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            os.close(slave)
            try:
                os.write(master, answers.encode())
                output, error = process.communicate(timeout=30)
                return process.returncode, output + error
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
                os.close(master)

        before = snapshot(self.root)
        interactive('Acme\nacme.com\nacme\nacme\nn\n')
        self.assertEqual(before, snapshot(self.root))
        code, output = interactive('Acme\nacme.com\nacme\nacme\ny\n')
        self.assertEqual(code, 0, output)
        self.assertTrue((self.root / 'backend/acme/settings/base.py').exists())
        self.assertEqual(env_values(self.root / '.env')['DB_NAME'], 'acme')

    def test_environment_collision_does_not_overwrite(self):
        (self.root / '.env').write_text('SECRET_KEY=existing-do-not-overwrite\n')
        before = snapshot(self.root)
        self.cli('--name', 'Acme', '--domain', 'acme.com', '--package', 'acme',
                 '--database', 'acme', '--yes', success=False)
        self.assertEqual(before, snapshot(self.root))

    def test_unrelated_files_and_migrations_remain_unchanged(self):
        unrelated = self.root / 'private-notes.txt'
        unrelated.write_text('Mobser core.settings.dev credentials stay here\n')
        migrations = {str(path.relative_to(self.root)): path.read_bytes()
                      for path in (self.root / 'backend/apps').glob('*/migrations/*.py')}
        self.initialize()
        self.assertEqual(unrelated.read_text(), 'Mobser core.settings.dev credentials stay here\n')
        self.assertTrue(migrations)
        for relative, content in migrations.items():
            self.assertEqual((self.root / relative).read_bytes(), content, relative)

    def test_package_and_journal_collision(self):
        for target in ('backend/acme', '.bootstrap-journal'):
            with self.subTest(target=target):
                path = self.root / target
                path.mkdir()
                before = snapshot(self.root)
                self.cli('--name', 'Acme', '--domain', 'acme.com', '--package', 'acme',
                         '--database', 'acme', '--yes', success=False)
                self.assertEqual(before, snapshot(self.root))
                path.rmdir()

    @unittest.skipUnless(hasattr(os, 'symlink'), 'symlinks unavailable')
    def test_symlink_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'README.md'
            shutil.move(self.root / 'README.md', target)
            (self.root / 'README.md').symlink_to(target)
            original = target.read_bytes()
            before = snapshot(self.root)
            self.cli('--name', 'Acme', '--domain', 'acme.com', '--package', 'acme',
                     '--database', 'acme', '--yes', success=False)
            self.assertEqual(before, snapshot(self.root))
            self.assertEqual(original, target.read_bytes())

    @unittest.skipUnless(shutil.which('git'), 'Git unavailable')
    def test_git_dirty_target_rejected_but_preview_allowed(self):
        def git(*args):
            subprocess.run(['git', *args], cwd=self.root, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        git('init', '-q')
        git('add', '.')
        git('-c', 'user.name=Bootstrap Tests', '-c', 'user.email=tests@example.invalid',
            'commit', '-qm', 'fixture')
        with (self.root / 'README.md').open('a') as stream:
            stream.write('\nLocal change\n')
        before = snapshot(self.root)
        args = ('--name', 'Acme', '--domain', 'acme.com', '--package', 'acme', '--database', 'acme')
        self.cli(*args, '--yes', success=False)
        self.cli(*args, '--dry-run')
        self.assertEqual(before, snapshot(self.root))

    def load_module(self):
        spec = importlib.util.spec_from_file_location('bootstrap_under_test', self.root / 'scripts/init_project.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        self.addCleanup(sys.modules.pop, spec.name, None)
        spec.loader.exec_module(module)
        return module

    def test_apply_failure_restores_original_bytes_and_modes(self):
        module = self.load_module()
        identity = module.Identity(name='Acme', domain='acme.com', package='acme', database='acme', slug='acme')
        plan = module.build_plan(self.root, identity)
        before = snapshot(self.root)
        write = module._atomic_write
        calls = 0

        def fail_once(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 5:
                raise OSError('simulated disk error')
            return write(*args, **kwargs)

        with patch.object(module, '_atomic_write', side_effect=fail_once):
            with self.assertRaises((OSError, module.BootstrapError)):
                module.apply_plan(self.root, plan)
        self.assertEqual(before, snapshot(self.root))

    def test_preview_does_not_generate_secrets(self):
        module = self.load_module()
        identity = module.Identity(name='Acme', domain='acme.com', package='acme', database='acme', slug='acme')
        before = snapshot(self.root)
        with patch.object(module.secrets, 'token_urlsafe', side_effect=AssertionError('secret generated in preview')):
            module.build_plan(self.root, identity)
        self.assertEqual(before, snapshot(self.root))

    @unittest.skipUnless(os.name == 'posix', 'entrypoint is a POSIX shell script')
    def test_renamed_production_entrypoint_collects_static_files(self):
        self.initialize()
        fake_bin = self.root / 'fake-bin'
        fake_bin.mkdir()
        fake_python = fake_bin / 'python'
        fake_python.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_TEST_CALLS"\n')
        fake_python.chmod(0o700)
        calls = self.root / 'python-calls.txt'
        for setting, expected in [('acme.settings.prod', True), ('acme.settings.dev', False)]:
            with self.subTest(setting=setting):
                calls.write_text('')
                env = {**os.environ, 'PATH': str(fake_bin) + os.pathsep + os.environ.get('PATH', ''),
                       'BOOTSTRAP_TEST_CALLS': str(calls), 'DJANGO_SETTINGS_MODULE': setting, 'DB_HOST': ''}
                subprocess.run(['sh', 'backend/entrypoint.sh', 'true'], cwd=self.root,
                               env=env, check=True, capture_output=True, timeout=10)
                self.assertEqual('manage.py collectstatic --noinput' in calls.read_text(), expected)


if __name__ == '__main__':
    unittest.main()
