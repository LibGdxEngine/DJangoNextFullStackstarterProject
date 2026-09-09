#!/usr/bin/python3 -I
"""Root-installed, fixed-target release controller. Never execute artifact content."""

import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile


BASE = Path('/srv/mobser-test')
REPOSITORY = 'LibGdxEngine/DJangoNextFullStackstarterProject'
PACKAGE = 'ghcr.io/libgdxengine/djangonextfullstackstarterproject'
PROJECT = 'mobser-test'
MIGRATION_CONTAINER = PROJECT + '-migrate'
APP_SERVICES = ['backend', 'frontend', 'celery_worker', 'celery_beat', 'gateway']
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
MAX_JSON = 1024 * 1024
MAX_ARCHIVE = 128 * 1024
# Reserve 1 GiB for existing host services, plus the capped deployment workload.
INITIAL_MEMORY_MINIMUM = 3 * 1024 ** 3
UPDATE_MEMORY_MINIMUM = 1536 * 1024 ** 2


class DeployError(Exception):
    pass


class Interrupted(DeployError):
    pass


def require(condition, message):
    if not condition:
        raise DeployError(message)


def positive(value, digits=20):
    require(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,' + str(digits - 1) + r'}', value),
            'invalid release identity')
    return int(value)


def parse_args(args):
    if len(args) == 3 and args[0] == 'deploy':
        return 'deploy', positive(args[1]), positive(args[2], 9)
    if args in (['rollback'], ['resolve-quarantine']):
        return args[0], None, None
    raise DeployError('invalid command')


def read_token(stream, timeout=10):
    selector = selectors.DefaultSelector()
    token = bytearray()
    deadline = time.monotonic() + timeout
    try:
        selector.register(stream, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0 and selector.select(remaining), 'token input timeout')
            chunk = os.read(stream.fileno(), 4097 - len(token))
            if not chunk:
                break
            token.extend(chunk)
            require(len(token) <= 4096, 'token input too large')
        value = bytes(token).strip()
        require(re.fullmatch(rb'[A-Za-z0-9_]+', value), 'invalid token')
        return value.decode('ascii')
    finally:
        selector.close()


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password,
                'unsafe artifact redirect')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected:
            redirected.remove_header('Authorization')
        return redirected


def fetch(url, token=None, limit=MAX_JSON):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'mobser-deployer',
               'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        require(urllib.parse.urlsplit(url).hostname == 'api.github.com', 'invalid token destination')
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=20) as response:
        data = response.read(limit + 1)
    require(len(data) <= limit, 'download too large')
    return data


def api(path, token):
    return json.loads(fetch('https://api.github.com/repos/' + REPOSITORY + path, token))


def validate_manifest(manifest, run, run_id, attempt, runtime_hash):
    require(isinstance(manifest, dict), 'invalid manifest')
    require(type(manifest.get('schema_version')) is int and manifest['schema_version'] == 1,
            'unsupported manifest schema')
    require(manifest.get('repository') == REPOSITORY and manifest.get('sha') == run['head_sha'],
            'manifest source mismatch')
    require(type(manifest.get('run_id')) is int and manifest['run_id'] == run_id and
            type(manifest.get('run_attempt')) is int and manifest['run_attempt'] == attempt,
            'manifest run mismatch')
    for service in ('backend', 'frontend'):
        require(isinstance(manifest.get(service + '_image'), str) and
                re.fullmatch(re.escape(PACKAGE + '-' + service) + r'@sha256:[0-9a-f]{64}',
                             manifest[service + '_image']), 'invalid image reference')
    require(manifest.get('runtime_sha256') == runtime_hash, 'runtime configuration mismatch')
    require(manifest.get('migration_compatible') is True, 'migration compatibility required')
    # Store only understood fields; artifacts can never select executable arguments.
    return {key: manifest[key] for key in ('schema_version', 'repository', 'sha', 'run_id',
            'run_attempt', 'backend_image', 'frontend_image', 'runtime_sha256', 'migration_compatible')}


def verified_release(run_id, attempt, token, runtime_hash):
    run = api('/actions/runs/' + str(run_id), token)
    require(run.get('id') == run_id and run.get('run_attempt') == attempt and
            type(run.get('run_number')) is int and run['run_number'] > 0, 'run identity mismatch')
    require(run.get('repository', {}).get('full_name') == REPOSITORY and
            run.get('head_repository', {}).get('full_name') == REPOSITORY and
            run.get('head_branch') == 'master' and run.get('path') == '.github/workflows/release.yml' and
            run.get('event') in ('push', 'workflow_dispatch') and
            re.fullmatch(r'[0-9a-f]{40}', run.get('head_sha', '')), 'untrusted workflow provenance')
    jobs = []
    for page in range(1, 11):
        batch = api(f'/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page={page}', token)
        jobs.extend(batch['jobs'])
        if len(batch['jobs']) < 100:
            break
    matches = [job for job in jobs if job.get('name') == 'Build and verify release']
    require(len(matches) == 1 and matches[0].get('status') == 'completed' and
            matches[0].get('conclusion') == 'success' and
            matches[0].get('run_id') == run_id and matches[0].get('run_attempt', attempt) == attempt,
            'release build has not succeeded')
    artifacts = api(f'/actions/runs/{run_id}/artifacts?per_page=100', token)
    require(artifacts.get('total_count', 101) <= 100, 'too many artifacts')
    matches = [item for item in artifacts['artifacts']
               if item.get('name') == f'release-{run_id}-{attempt}']
    require(len(matches) == 1 and matches[0].get('expired') is False and
            type(matches[0].get('id')) is int and matches[0]['id'] > 0 and
            0 < matches[0].get('size_in_bytes', 0) <= MAX_ARCHIVE, 'invalid release artifact')
    data = fetch(f'https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{matches[0]["id"]}/zip',
                 token, MAX_ARCHIVE)
    digest = matches[0].get('digest')
    require(isinstance(digest, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', digest) and
            digest == 'sha256:' + hashlib.sha256(data).hexdigest(), 'artifact digest mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        require(archive.namelist() == ['release.json'], 'unexpected artifact contents')
        info = archive.getinfo('release.json')
        require(info.file_size <= 16384 and not info.is_dir(), 'invalid manifest size')
        manifest = json.loads(archive.read(info))
    return validate_manifest(manifest, run, run_id, attempt, runtime_hash), [run['run_number'], attempt]


def protected(path, directory=False):
    info = path.lstat()
    require(info.st_uid == 0 and not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode) and
            (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)),
            'unsafe host configuration ownership')


def atomic_state(state):
    descriptor, name = tempfile.mkstemp(prefix='.state-', dir=BASE)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(state, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, BASE / 'state.json')
        directory = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextlib.contextmanager
def deployment_lock():
    descriptor = os.open(BASE / 'deploy.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        protected(BASE / 'deploy.lock')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise DeployError('another deployment is active') from None
        yield
    finally:
        os.close(descriptor)


def run_command(args, timeout=180, input_data=None, env=None, output=None, input_file=None):
    child = subprocess.Popen(args, stdin=input_file if input_file is not None else
                             (subprocess.PIPE if input_data is not None else subprocess.DEVNULL),
                             stdout=output if output is not None else subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, env=env or ENV, start_new_session=True)
    try:
        child.communicate(input=input_data, timeout=timeout)
        require(child.returncode == 0, 'command failed (exit ' + str(child.returncode) + ')')
    except BaseException:
        # The entire process group is killed and reaped before the deployment lock can leave scope.
        blocked = {signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM}
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, blocked)
        try:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)
        raise


class Controller:
    def __init__(self):
        protected(BASE, directory=True)
        for name in ('compose.yml', 'gateway.Caddyfile', 'runtime.env', 'config.json'):
            protected(BASE / name)
        require(not (BASE / 'runtime.env').stat().st_mode & 0o077, 'runtime secrets must be private')
        self.config = json.loads((BASE / 'config.json').read_text())
        public = urllib.parse.urlsplit(self.config.get('public_url', ''))
        require(public.scheme == 'https' and public.hostname and not public.username and
                not public.password and public.path in ('', '/') and not public.query and not public.fragment,
                'invalid public URL')
        self.url = self.config['public_url'].rstrip('/')
        self.runtime_hash = hashlib.sha256((BASE / 'compose.yml').read_bytes() +
                                           (BASE / 'gateway.Caddyfile').read_bytes()).hexdigest()
        self.state = {'current': None, 'previous': None, 'candidate': None,
                      'stage': 'idle', 'highest_accepted': [0, 0]}
        if (BASE / 'state.json').exists():
            protected(BASE / 'state.json')
            self.state = json.loads((BASE / 'state.json').read_text())
        if self.state['stage'] in ('migration_started', 'migration_completed', 'rollback_started',
                                   'recovery_failed', 'rollback_failed', 'quarantined'):
            self.stage('quarantined')

    def stage(self, value):
        self.state['stage'] = value
        atomic_state(self.state)
        print('deployment stage: ' + value, flush=True)

    def compose(self, release, args, timeout=180, output=None, extra_env=None):
        environment = dict(ENV, BACKEND_IMAGE=release['backend_image'], FRONTEND_IMAGE=release['frontend_image'])
        environment.update(extra_env or {})
        run_command(['/usr/bin/docker', 'compose', '--project-name', PROJECT, '--env-file',
                     str(BASE / 'runtime.env'), '--file', str(BASE / 'compose.yml'), *args],
                    timeout=timeout, env=environment, output=output)

    def capacity(self):
        disk_minimum = max(5 * 1024 ** 3, self.config.get('minimum_free_disk_bytes', 0))
        baseline = UPDATE_MEMORY_MINIMUM if self.state['current'] else INITIAL_MEMORY_MINIMUM
        memory_minimum = max(baseline, self.config.get('minimum_available_memory_bytes', 0))
        require(shutil.disk_usage(BASE).free >= disk_minimum, 'insufficient disk capacity')
        available = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()
                         if line.startswith('MemAvailable:'))
        require(available >= memory_minimum, 'insufficient memory capacity')

    def health(self):
        deadline = time.monotonic() + 180
        while True:
            try:
                ready = json.loads(fetch(self.url + '/api/health/ready/', limit=16384))
                require(isinstance(ready, dict) and ready and all(value == 'up' for value in ready.values()),
                        'backend not ready')
                session = json.loads(fetch(self.url + '/api/auth/session', limit=65536))
                require(isinstance(session, (dict, type(None))), 'invalid auth session response')
                home = fetch(self.url + '/', limit=1024 * 1024)
                require(b'<html' in home.lower(), 'invalid frontend response')
                return
            except Interrupted:
                raise
            except Exception:
                if time.monotonic() >= deadline:
                    raise DeployError('public readiness failed') from None
                time.sleep(3)

    def pull(self, release, token):
        with tempfile.TemporaryDirectory(prefix='.docker-', dir=BASE) as directory:
            os.chmod(directory, 0o700)
            environment = dict(ENV, DOCKER_CONFIG=directory)
            run_command(['/usr/bin/docker', 'login', 'ghcr.io', '--username', 'LibGdxEngine', '--password-stdin'],
                        input_data=(token + '\n').encode(), env=environment, timeout=60)
            self.compose(release, ['pull', 'backend', 'frontend'], timeout=180,
                         extra_env={'DOCKER_CONFIG': directory})

    def backup(self, release):
        directory = BASE / 'backups'
        directory.mkdir(mode=0o700, exist_ok=True)
        protected(directory, directory=True)
        filename = directory / f'{release["run_id"]}-{release["run_attempt"]}.dump'
        with filename.open('xb') as output:
            os.chmod(filename, 0o600)
            # Only this fixed root-authored shell fragment expands container database configuration.
            self.compose(release, ['exec', '-T', 'db', 'sh', '-ec',
                         'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],
                         timeout=120, output=output)
            output.flush()
            os.fsync(output.fileno())
        require(filename.stat().st_size > 0, 'database backup is empty')
        with filename.open('rb') as source:
            run_command(['/usr/bin/docker', 'compose', '--project-name', PROJECT, '--env-file',
                         str(BASE / 'runtime.env'), '--file', str(BASE / 'compose.yml'),
                         'exec', '-T', 'db', 'pg_restore', '--list'], timeout=60,
                        input_file=source, env=dict(ENV, BACKEND_IMAGE=release['backend_image'],
                                                         FRONTEND_IMAGE=release['frontend_image']))

    def cleanup_migration(self):
        def exists():
            with tempfile.TemporaryFile() as output:
                run_command(['/usr/bin/docker', 'container', 'ls', '--all', '--filter',
                             'name=^/' + MIGRATION_CONTAINER + '$', '--format', '{{.ID}}'],
                            timeout=15, output=output)
                output.seek(0)
                return bool(output.read(1024).strip())

        previous = signal.pthread_sigmask(signal.SIG_BLOCK,
                                         {signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM})
        try:
            if not exists():
                return
            try:
                run_command(['/usr/bin/docker', 'rm', '--force', MIGRATION_CONTAINER], timeout=30)
            except (DeployError, subprocess.TimeoutExpired):
                # --rm may have removed the container between listing and explicit removal.
                require(not exists(), 'migration container cleanup failed')
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    def start_apps(self, release):
        self.compose(release, ['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', *APP_SERVICES],
                     timeout=210)
        self.health()

    def deploy(self, run_id, attempt, token):
        require(self.state['stage'] != 'quarantined', 'migration quarantine requires administrator resolution')
        release, order = verified_release(run_id, attempt, token, self.runtime_hash)
        if release == self.state['current']:
            self.health()
            return
        require(tuple(order) > tuple(self.state['highest_accepted']), 'historical release replay rejected')
        self.capacity()
        self.state.update(highest_accepted=order, candidate=release)
        self.stage('accepted')
        try:
            self.pull(release, token)
            self.stage('pulled')
            self.compose(release, ['up', '-d', '--wait', '--wait-timeout', '90', 'db', 'redis'], timeout=120)
            # An existing selected release guarantees an existing DB; a first attempt can also
            # contain data after an earlier interruption, so back up even an initially empty DB.
            self.backup(release)
            self.stage('migration_started')
            try:
                self.compose(release, ['run', '--rm', '--no-deps', '--name', MIGRATION_CONTAINER,
                             '-e', 'PGOPTIONS=-c lock_timeout=10000 -c statement_timeout=240000',
                             '-e', 'RUN_MIGRATIONS=false', '-e', 'RUN_COLLECTSTATIC=false',
                             'backend', 'python', 'manage.py', 'migrate', '--noinput'], timeout=300)
            except BaseException:
                self.cleanup_migration()
                raise
            self.stage('migration_completed')
            self.start_apps(release)
            self.state.update(previous=self.state['current'], current=release, candidate=None)
            self.stage('healthy')
        except (Interrupted, subprocess.TimeoutExpired):
            # Docker may still be changing containers after its client is stopped.
            # Require an operator to reconcile state before any further Compose call.
            self.stage('quarantined')
            raise
        except BaseException:
            if self.state['stage'] == 'migration_started':
                self.stage('quarantined')
            elif self.state['stage'] == 'migration_completed':
                old = self.state['current']
                if old and release['migration_compatible']:
                    try:
                        self.start_apps(old)
                        self.stage('failed_recovered')
                    except BaseException:
                        self.stage('recovery_failed')
                else:
                    self.stage('failed_no_previous')
            else:
                self.stage('failed')
            raise

    def rollback(self):
        require(self.state['stage'] != 'quarantined', 'migration quarantine requires administrator resolution')
        previous = self.state['previous']
        require(previous is not None, 'no previous release')
        self.stage('rollback_started')
        try:
            self.start_apps(previous)
        except BaseException:
            self.stage('rollback_failed')
            raise
        self.state.update(current=previous, previous=self.state['current'], candidate=None)
        self.stage('healthy')

    def resolve_quarantine(self):
        require(self.state['stage'] == 'quarantined', 'no migration quarantine')
        self.cleanup_migration()
        self.stage('quarantine_resolved')


def interrupted(signum, frame):
    raise Interrupted('deployment interrupted')


def main():
    try:
        require(os.geteuid() == 0, 'root required')
        command, run_id, attempt = parse_args(sys.argv[1:])
        for item in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM):
            signal.signal(item, interrupted)
        signal.alarm(900)
        protected(BASE, directory=True)
        with deployment_lock():
            controller = Controller()
            if command == 'deploy':
                controller.deploy(run_id, attempt, read_token(sys.stdin.buffer))
            elif command == 'rollback':
                controller.rollback()
            else:
                controller.resolve_quarantine()
        return 0
    except Exception as error:
        # Only our deliberately sanitized errors are safe to display.
        print(str(error) if isinstance(error, DeployError) else 'deployment failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
