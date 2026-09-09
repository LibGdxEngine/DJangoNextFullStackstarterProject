"""No Docker, credentials, network or root privileges are required by these tests."""

import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.request
import zipfile


SPEC = importlib.util.spec_from_file_location('controller', Path(__file__).parents[1] / 'controller.py')
c = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(c)


def release(run_id=10, attempt=1):
    return {'schema_version': 1, 'repository': c.REPOSITORY, 'sha': 'a' * 40,
            'run_id': run_id, 'run_attempt': attempt,
            'backend_image': c.PACKAGE + '-backend@sha256:' + 'b' * 64,
            'frontend_image': c.PACKAGE + '-frontend@sha256:' + 'c' * 64,
            'runtime_sha256': 'd' * 64, 'migration_compatible': True}


class ParserTests(unittest.TestCase):
    def test_deploy_and_admin_commands(self):
        self.assertEqual(c.parse_args(['deploy', '10', '1']), ('deploy', 10, 1))
        self.assertEqual(c.parse_args(['rollback'])[0], 'rollback')
        self.assertEqual(c.parse_args(['resolve-quarantine'])[0], 'resolve-quarantine')

    def test_malformed_commands(self):
        for args in ([], ['id'], ['deploy', '0', '1'], ['deploy', '-1', '1'],
                     ['deploy', '01', '1'], ['deploy', '1;id', '1'], ['deploy', '1', '1', 'x'],
                     ['deploy', '1', '1234567890'], ['deploy', '1' * 21, '1']):
            with self.subTest(args=args), self.assertRaises(c.DeployError):
                c.parse_args(args)

    def test_dispatch_rejects_shell_and_admin(self):
        for command in ('id', 'rollback', 'resolve-quarantine', 'deploy 1 1;id',
                        'deploy 1 1\nid', 'deploy 01 1', 'deploy 1 1 ', ' deploy 1 1',
                        'deploy 1 1\n', 'deploy 1  1', 'deploy $(id) 1'):
            result = subprocess.run(['/bin/sh', str(Path(__file__).parents[1] / 'ssh-dispatch.sh')],
                                    env={'SSH_ORIGINAL_COMMAND': command}, capture_output=True)
            self.assertEqual(result.returncode, 64, command)

    def test_bearer_token_formats_and_transport_newline(self):
        for token in (b'ghs_example', b'header.payload.signature', b'token-with-dashes',
                      b'AZaz09._~+/-==', b'x' * 4096):
            reader, writer = os.pipe()
            os.write(writer, token)
            os.close(writer)
            with os.fdopen(reader, 'rb') as source:
                self.assertEqual(c.read_token(source), token.decode('ascii'))
        reader, writer = os.pipe()
        os.write(writer, b'header.payload.signature\n')
        os.close(writer)
        with os.fdopen(reader, 'rb') as source:
            self.assertEqual(c.read_token(source), 'header.payload.signature')

    def test_token_bounded_and_injection_rejected_without_logging(self):
        for token in (b'x' * 4097, b'has space', b'', b' leading', b'trailing ',
                      b'has\ttab', b'trailing\t', b'token\r', b'token\n\n',
                      b'token\r\nX-Injected: yes', b'token\nX-Injected: yes',
                      b'token\x00', b'token\x7f', b'token\xff', b'==', b'ab=cd'):
            reader, writer = os.pipe()
            os.write(writer, token)
            os.close(writer)
            with os.fdopen(reader, 'rb') as source, \
                    patch('sys.stdout', new_callable=io.StringIO) as stdout, \
                    patch('sys.stderr', new_callable=io.StringIO) as stderr:
                with self.assertRaises(c.DeployError) as raised:
                    c.read_token(source)
                self.assertIn(str(raised.exception), ('invalid token', 'token input too large'))
                self.assertEqual(stdout.getvalue(), '')
                self.assertEqual(stderr.getvalue(), '')

    def test_token_timeout(self):
        reader, writer = os.pipe()
        try:
            with os.fdopen(reader, 'rb') as source, self.assertRaises(c.DeployError):
                c.read_token(source, timeout=0.01)
        finally:
            os.close(writer)


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.run = {'id': 10, 'run_attempt': 1, 'run_number': 5,
                    'repository': {'full_name': c.REPOSITORY},
                    'head_repository': {'full_name': c.REPOSITORY},
                    'head_branch': 'master', 'path': '.github/workflows/release.yml',
                    'event': 'push', 'head_sha': 'a' * 40, 'status': 'in_progress'}
        self.job = {'name': 'Build and verify release', 'status': 'completed',
                    'conclusion': 'success', 'run_id': 10, 'run_attempt': 1}
        self.artifact = {'id': 22, 'name': 'release-10-1', 'expired': False, 'size_in_bytes': 1024}
        self.manifest = release()
        self.archive_path = 'release.json'

    def verify(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr(self.archive_path, json.dumps(self.manifest))
        artifact = {'digest': 'sha256:' + hashlib.sha256(archive.getvalue()).hexdigest(), **self.artifact}
        with patch.object(c, 'api', side_effect=[self.run, {'jobs': [self.job]},
                          {'total_count': 1, 'artifacts': [artifact]}]), \
                patch.object(c, 'fetch', return_value=archive.getvalue()):
            return c.verified_release(10, 1, 'token', 'd' * 64)

    def test_running_workflow_with_successful_build_is_eligible(self):
        self.assertEqual(self.verify(), (release(), [5, 1]))

    def test_attempt_scoped_jobs_do_not_require_undocumented_attempt_field(self):
        del self.job['run_attempt']
        self.assertEqual(self.verify(), (release(), [5, 1]))

    def test_untrusted_workflows_rejected(self):
        for field, value in [('repository', {'full_name': 'attacker/repo'}),
                             ('head_repository', {'full_name': 'attacker/repo'}),
                             ('head_branch', 'feature'), ('path', '.github/workflows/evil.yml'),
                             ('event', 'pull_request'), ('run_attempt', 2), ('head_sha', 'abc'),
                             ('run_number', '5')]:
            previous = self.run[field]
            self.run[field] = value
            with self.subTest(field=field), self.assertRaises(c.DeployError):
                self.verify()
            self.run[field] = previous

    def test_build_job_checks(self):
        for field, value in [('name', 'Fake build'), ('status', 'in_progress'),
                             ('conclusion', 'failure'), ('run_attempt', 2), ('run_id', 11)]:
            previous = self.job[field]
            self.job[field] = value
            with self.subTest(field=field), self.assertRaises(c.DeployError):
                self.verify()
            self.job[field] = previous

    def test_artifact_checks(self):
        for field, value in [('expired', True), ('name', 'release-10-2'),
                             ('id', '../evil'), ('size_in_bytes', c.MAX_ARCHIVE + 1)]:
            previous = self.artifact[field]
            self.artifact[field] = value
            with self.subTest(field=field), self.assertRaises(c.DeployError):
                self.verify()
            self.artifact[field] = previous
        self.archive_path = '../release.json'
        with self.assertRaises(c.DeployError):
            self.verify()

    def test_artifact_digest_is_required_and_binds_archive_bytes(self):
        for digest in (None, 'sha256:' + '0' * 64, 'md5:abc'):
            self.artifact['digest'] = digest
            with self.subTest(digest=digest), self.assertRaisesRegex(c.DeployError, 'artifact digest'):
                self.verify()

    def test_manifest_restrictions(self):
        for field, value in [('repository', 'attacker/repo'), ('sha', 'f' * 40),
                             ('run_id', 11), ('run_attempt', True), ('schema_version', True),
                             ('backend_image', 'evil/image:latest'),
                             ('frontend_image', c.PACKAGE + '-frontend@sha256:' + 'a' * 63),
                             ('runtime_sha256', 'e' * 64), ('migration_compatible', False)]:
            previous = self.manifest[field]
            self.manifest[field] = value
            with self.subTest(field=field), self.assertRaises(c.DeployError):
                self.verify()
            self.manifest[field] = previous

    def test_redirect_drops_token(self):
        request = urllib.request.Request('https://api.github.com/artifact',
                                         headers={'Authorization': 'Bearer secret'})
        redirected = c.SafeRedirect().redirect_request(request, None, 302, 'Found', {},
                                                       'https://blob.example/file?signed=ok')
        self.assertFalse(redirected.has_header('Authorization'))
        with self.assertRaises(c.DeployError):
            c.SafeRedirect().redirect_request(request, None, 302, 'Found', {}, 'http://blob.example/file')

    def test_token_destination_is_fixed(self):
        with self.assertRaises(c.DeployError):
            c.fetch('https://attacker.example', token='secret')


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for name, content in [('compose.yml', 'compose'), ('gateway.Caddyfile', 'gateway'),
                              ('runtime.env', ''), ('config.json', '{"public_url":"https://test.example"}')]:
            (self.base / name).write_text(content)
            (self.base / name).chmod(0o600)
        for patcher in (patch.object(c, 'BASE', self.base), patch.object(c, 'protected')):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.controller = c.Controller()
        self.controller.compose = Mock()
        self.controller.pull = Mock()
        self.controller.capacity = Mock()
        self.controller.backup = Mock()
        self.controller.health = Mock()
        self.controller.cleanup_migration = Mock()
        self.verified = patch.object(c, 'verified_release', return_value=(release(), [5, 1])).start()
        self.addCleanup(patch.stopall)

    def deploy(self):
        self.controller.deploy(10, 1, 'token')

    def test_first_deploy_persists_and_hashes_runtime(self):
        import hashlib
        self.assertEqual(self.controller.runtime_hash, hashlib.sha256(b'composegateway').hexdigest())
        self.deploy()
        state = json.loads((self.base / 'state.json').read_text())
        self.assertEqual(state['current'], release())
        self.assertIsNone(state['previous'])
        self.assertIsNone(state['candidate'])
        self.assertEqual(state['highest_accepted'], [5, 1])
        self.assertEqual(state['stage'], 'healthy')
        self.assertEqual((self.base / 'state.json').stat().st_mode & 0o777, 0o600)
        migrations = [call for call in self.controller.compose.call_args_list if 'migrate' in call.args[1]]
        self.assertEqual(len(migrations), 1)
        self.assertIn(c.MIGRATION_CONTAINER, migrations[0].args[1])

    def test_previous_promotion_and_exact_health_only_retry(self):
        old = release(9)
        self.controller.state['current'] = old
        self.deploy()
        self.assertEqual(self.controller.state['previous'], old)
        self.controller.compose.reset_mock()
        self.controller.pull.reset_mock()
        self.deploy()
        self.controller.compose.assert_not_called()
        self.controller.pull.assert_not_called()
        self.assertEqual(self.controller.health.call_count, 2)

    def test_old_release_rejected_before_compose(self):
        self.controller.state['highest_accepted'] = [6, 1]
        with self.assertRaisesRegex(c.DeployError, 'replay'):
            self.deploy()
        self.controller.compose.assert_not_called()
        self.controller.pull.assert_not_called()

    def test_provenance_or_capacity_failure_has_zero_mutations(self):
        self.verified.side_effect = c.DeployError('untrusted')
        with self.assertRaises(c.DeployError):
            self.deploy()
        self.assertEqual(self.controller.state['highest_accepted'], [0, 0])
        self.controller.compose.assert_not_called()
        self.controller.pull.assert_not_called()
        self.verified.side_effect = None
        self.controller.capacity.side_effect = c.DeployError('capacity')
        with self.assertRaises(c.DeployError):
            self.deploy()
        self.assertEqual(self.controller.state['highest_accepted'], [0, 0])
        self.controller.compose.assert_not_called()
        self.controller.pull.assert_not_called()

    def test_registry_failure_retains_watermark_and_higher_attempt_can_retry(self):
        self.controller.pull.side_effect = c.DeployError('registry failed')
        with self.assertRaises(c.DeployError):
            self.deploy()
        self.assertEqual(self.controller.state['highest_accepted'], [5, 1])
        self.assertEqual(self.controller.state['stage'], 'failed')
        self.controller.compose.assert_not_called()
        self.controller.pull.side_effect = None
        with self.assertRaisesRegex(c.DeployError, 'replay'):
            self.deploy()
        self.verified.return_value = (release(10, 2), [5, 2])
        self.controller.deploy(10, 2, 'token')
        self.assertEqual(self.controller.state['current']['run_attempt'], 2)

    def test_migration_failure_quarantines_and_preserves_selected_release(self):
        old = release(9)
        self.controller.state['current'] = old
        self.controller.compose.side_effect = [None, c.DeployError('migration failed')]
        with self.assertRaises(c.DeployError):
            self.deploy()
        self.assertEqual(self.controller.state['stage'], 'quarantined')
        self.assertEqual(self.controller.state['current'], old)
        self.assertEqual(self.controller.state['candidate'], release())
        self.controller.cleanup_migration.assert_called_once()
        self.verified.return_value = (release(10, 2), [5, 2])
        with self.assertRaisesRegex(c.DeployError, 'quarantine'):
            self.controller.deploy(10, 2, 'token')
        self.controller.resolve_quarantine()
        self.assertEqual(self.controller.state['highest_accepted'], [5, 1])
        self.assertEqual(self.controller.state['stage'], 'quarantine_resolved')

    def test_interrupted_marker_becomes_quarantine_on_restart(self):
        self.controller.state.update(stage='migration_started', candidate=release(), highest_accepted=[5, 1])
        c.atomic_state(self.controller.state)
        restarted = c.Controller()
        self.assertEqual(restarted.state['stage'], 'quarantined')
        self.assertEqual(restarted.state['highest_accepted'], [5, 1])

    def test_interrupted_compose_quarantines_without_recovery_or_retry(self):
        for phase in ('dependencies', 'candidate'):
            for error in (c.Interrupted('interrupted'), subprocess.TimeoutExpired('compose', 1)):
                with self.subTest(phase=phase, error=type(error).__name__):
                    self.controller.state.update(
                        stage='healthy', current=release(9), previous=None,
                        candidate=None, highest_accepted=[0, 0],
                    )
                    self.verified.return_value = (release(), [5, 1])
                    self.controller.compose.reset_mock()
                    calls_before_failure = 0 if phase == 'dependencies' else 2
                    self.controller.compose.side_effect = [None] * calls_before_failure + [error]
                    with self.assertRaises(type(error)):
                        self.deploy()
                    self.assertEqual(self.controller.state['stage'], 'quarantined')
                    self.assertEqual(self.controller.state['current'], release(9))
                    self.assertEqual(self.controller.state['candidate'], release())
                    self.assertEqual(self.controller.compose.call_count, calls_before_failure + 1)
                    self.verified.return_value = (release(10, 2), [5, 2])
                    with self.assertRaisesRegex(c.DeployError, 'quarantine'):
                        self.controller.deploy(10, 2, 'token')
                    self.assertEqual(self.controller.compose.call_count, calls_before_failure + 1)

    def test_interrupted_rollout_and_rollback_require_operator_resolution(self):
        for stage in ('migration_completed', 'rollback_started', 'recovery_failed', 'rollback_failed'):
            with self.subTest(stage=stage):
                self.controller.state.update(stage=stage, current=release(9), candidate=release(),
                                             highest_accepted=[5, 1])
                c.atomic_state(self.controller.state)
                restarted = c.Controller()
                self.assertEqual(restarted.state['stage'], 'quarantined')
                self.assertEqual(restarted.state['current'], release(9))
                self.verified.return_value = (release(11), [6, 1])
                with self.assertRaisesRegex(c.DeployError, 'quarantine'):
                    restarted.deploy(11, 1, 'token')

    def test_capacity_retains_host_reserve_and_accounts_for_initial_peak(self):
        del self.controller.capacity
        with patch.object(c.shutil, 'disk_usage', return_value=Mock(free=10 * 1024 ** 3)), \
                patch.object(c.Path, 'read_text', return_value='MemAvailable: 2097152 kB\n'):
            with self.assertRaisesRegex(c.DeployError, 'memory'):
                self.controller.capacity()
            self.controller.state['current'] = release(9)
            self.controller.capacity()
            self.controller.config['minimum_available_memory_bytes'] = 4 * 1024 ** 3
            with self.assertRaisesRegex(c.DeployError, 'memory'):
                self.controller.capacity()
        self.controller.config['minimum_available_memory_bytes'] = 1
        with patch.object(c.shutil, 'disk_usage', return_value=Mock(free=10 * 1024 ** 3)), \
                patch.object(c.Path, 'read_text', return_value='MemAvailable: 1258291 kB\n'):
            with self.assertRaisesRegex(c.DeployError, 'memory'):
                self.controller.capacity()

    def test_migration_cleanup_accepts_absent_or_concurrently_removed_container(self):
        del self.controller.cleanup_migration
        with patch.object(c, 'run_command') as command:
            self.controller.cleanup_migration()
            self.assertEqual(command.call_count, 1)
            self.assertIn('ls', command.call_args.args[0])

        listings = iter((b'abc123\n', b''))
        def cleanup(args, **kwargs):
            if 'ls' in args:
                kwargs['output'].write(next(listings))
            else:
                raise c.DeployError('already removed')
        with patch.object(c, 'run_command', side_effect=cleanup) as command:
            self.controller.cleanup_migration()
            self.assertEqual(command.call_count, 3)

    def test_failed_migration_cleanup_blocks_quarantine_resolution(self):
        del self.controller.cleanup_migration
        self.controller.state['stage'] = 'quarantined'
        def cleanup(args, **kwargs):
            if 'ls' in args:
                kwargs['output'].write(b'abc123\n')
            else:
                raise subprocess.TimeoutExpired('docker rm', 30)
        with patch.object(c, 'run_command', side_effect=cleanup), \
                self.assertRaisesRegex(c.DeployError, 'cleanup failed'):
            self.controller.resolve_quarantine()
        self.assertEqual(self.controller.state['stage'], 'quarantined')

    def test_readiness_failure_recovers_old_images(self):
        old = release(9)
        previous = release(8)
        self.controller.state.update(current=old, previous=previous)
        self.controller.health.side_effect = [c.DeployError('unhealthy'), None]
        with self.assertRaises(c.DeployError):
            self.deploy()
        self.assertEqual(self.controller.state['stage'], 'failed_recovered')
        self.assertEqual(self.controller.state['current'], old)
        self.assertEqual(self.controller.state['previous'], previous)
        self.assertEqual(self.controller.compose.call_args.args[0], old)

    def test_first_deploy_readiness_failure_reports_no_previous(self):
        self.controller.health.side_effect = c.DeployError('unhealthy')
        with self.assertRaises(c.DeployError):
            self.deploy()
        self.assertEqual(self.controller.state['stage'], 'failed_no_previous')
        self.assertIsNone(self.controller.state['current'])

    def test_readiness_does_not_swallow_interruption(self):
        del self.controller.health
        with patch.object(c, 'fetch', side_effect=c.Interrupted('interrupted')), \
                patch.object(c.time, 'sleep') as sleep, self.assertRaises(c.Interrupted):
            self.controller.health()
        sleep.assert_not_called()

    def test_rollback_preserves_watermark_and_rejects_replay(self):
        self.controller.state.update(current=release(11), previous=release(), highest_accepted=[6, 1])
        self.controller.rollback()
        self.assertEqual(self.controller.state['current'], release())
        self.assertEqual(self.controller.state['previous'], release(11))
        self.assertEqual(self.controller.state['highest_accepted'], [6, 1])
        self.verified.return_value = (release(11), [6, 1])
        self.controller.compose.reset_mock()
        with self.assertRaisesRegex(c.DeployError, 'replay'):
            self.controller.deploy(11, 1, 'token')
        self.controller.compose.assert_not_called()

    def test_rollback_failure_preserves_release_selection(self):
        before = self.controller.state.copy()
        before.update(current=release(11), previous=release(), highest_accepted=[6, 1])
        self.controller.state.update(before)
        self.controller.health.side_effect = c.DeployError('unhealthy')
        with self.assertRaises(c.DeployError):
            self.controller.rollback()
        for field in ('current', 'previous', 'highest_accepted'):
            self.assertEqual(self.controller.state[field], before[field])
        self.assertEqual(self.controller.state['stage'], 'rollback_failed')

    def test_lock_rejects_concurrent_invocation_and_releases(self):
        with c.deployment_lock():
            with self.assertRaisesRegex(c.DeployError, 'another deployment'):
                with c.deployment_lock():
                    self.fail('overlapping deploy lock')
        with c.deployment_lock():
            pass

    def test_registry_configuration_is_private_and_removed_on_failure(self):
        del self.controller.pull
        folders = []
        def login(*args, **kwargs):
            folder = Path(kwargs['env']['DOCKER_CONFIG'])
            folders.append(folder)
            self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
            self.assertNotIn('token', repr(args))
            self.assertEqual(kwargs['input_data'], b'token\n')
            raise c.DeployError('login failed')
        with patch.object(c, 'run_command', side_effect=login), self.assertRaises(c.DeployError):
            self.controller.pull(release(), 'token')
        self.assertFalse(folders[0].exists())


class ProcessTests(unittest.TestCase):
    def test_timeout_kills_group_and_reaps_before_return(self):
        child = Mock(pid=123)
        child.communicate.side_effect = subprocess.TimeoutExpired('command', 1)
        with patch.object(c.subprocess, 'Popen', return_value=child), \
                patch.object(c.os, 'killpg') as kill, self.assertRaises(subprocess.TimeoutExpired):
            c.run_command(['unused'], timeout=1)
        kill.assert_called_once_with(123, signal.SIGKILL)
        child.wait.assert_called_once()

    def test_signal_kills_group_and_reaps_before_return(self):
        child = Mock(pid=124)
        child.communicate.side_effect = c.DeployError('interrupted')
        with patch.object(c.subprocess, 'Popen', return_value=child), \
                patch.object(c.os, 'killpg') as kill, self.assertRaises(c.DeployError):
            c.run_command(['unused'])
        kill.assert_called_once_with(124, signal.SIGKILL)
        child.wait.assert_called_once()


if __name__ == '__main__':
    unittest.main()
