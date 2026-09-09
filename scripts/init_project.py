#!/usr/bin/env python3
"""Initialize a fresh starter checkout using only Python's standard library."""

import argparse
import ast
from dataclasses import asdict, dataclass, field
import io
import json
import keyword
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import tokenize
import unicodedata

VERSION = 1
MANIFEST = '.bootstrap.json'
JOURNAL = '.bootstrap-journal'
SECRET_KEYS = (
    'SECRET_KEY', 'NEXTAUTH_SECRET', 'OTP_SECRET', 'DB_PASSWORD',
    'RATE_LIMIT_PROXY_TOKEN', 'RATE_LIMIT_KEY_SECRET',
)
# Only these owned sources may be rewritten. Python files inside the project
# configuration package are also included; application migrations are untouched.
FILES = (
    'AGENTS.md', 'README.md', 'frontend/README.md', 'backend/product/README.md',
    'docs/bootstrap.md', 'Makefile', '.env.example', '.env.prod.example',
    'docker-compose.yml', 'docker-compose.prod.yml', 'backend/manage.py',
    'backend/gunicorn.conf.py', 'backend/entrypoint.sh', 'backend/Dockerfile.prod',
    'backend/apps/__init__.py', 'backend/product/__init__.py',
    'backend/apps/accounts/services/password.py',
    'backend/apps/accounts/services/verification.py',
    'backend/apps/accounts/api/views/profile.py',
    'backend/apps/accounts/api/views/auth.py',
    'backend/apps/accounts/api/views/social.py',
    'backend/apps/accounts/api/views/verification.py',
    'backend/apps/common/tasks/base.py',
    'backend/apps/integrations/hireagents/webhooks.py',
    'backend/apps/common/tests/test_api_errors.py',
    'backend/apps/common/tests/test_observability.py',
    'backend/apps/notifications/tests/test_tasks.py',
    'scripts/api-contract.sh', 'scripts/seed_dev_data.py',
    'scripts/check-observability.py', 'scripts/check-observability-trace.py',
    'frontend/package.json',
    'frontend/package-lock.json', 'backend/openapi.json',
    'frontend/src/app/layout.tsx', 'frontend/src/app/page.tsx',
    'frontend/src/features/overview/components/ArchitectureGuide.tsx',
    'frontend/src/lib/auth.ts', 'frontend/src/lib/auth-vault.ts',
    'frontend/src/lib/telemetry/logger.ts',
    'frontend/src/lib/telemetry/server.ts', 'observability/collector.yaml',
    'observability/alerts.yaml', 'observability/tests/probe_logs.py',
    'observability/grafana/provisioning/dashboards/default.yaml',
    'observability/grafana/dashboards/mobser.json',
)


class BootstrapError(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    name: str
    domain: str
    package: str
    database: str
    slug: str

    @property
    def metric_prefix(self):
        return self.slug.replace('-', '_')


@dataclass
class Plan:
    identity: Identity
    edits: dict = field(default_factory=dict)
    moves: list = field(default_factory=list)
    originals: dict = field(default_factory=dict)
    modes: dict = field(default_factory=dict)
    conflicts: list = field(default_factory=list)
    git_available: bool = False


def _safe_path(root, relative):
    relative = Path(relative)
    if relative.is_absolute() or '..' in relative.parts:
        raise BootstrapError(f'Unsafe target path: {relative}')
    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            raise BootstrapError(f'Symlink target is not supported: {relative}')
    return path


def validate_identity(root, identity):
    name = identity.name
    if (not name.strip() or name != name.strip() or len(name) > 200
            or len(name.splitlines()) != 1
            or any(unicodedata.category(c).startswith('C') for c in name)
            or any(c in name for c in '\r\n`$;|<>\\')):
        raise BootstrapError('Project name must be single-line text without shell syntax (up to 200 characters).')
    if not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', identity.slug) or len(identity.slug) > 50:
        raise BootstrapError('Slug must start with a lowercase letter and contain lowercase ASCII letters, numbers, or single hyphens (up to 50 characters).')
    package = identity.package
    reserved = set(getattr(sys, 'stdlib_module_names', ())) | set(sys.builtin_module_names)
    reserved |= {
        'django', 'celery', 'rest_framework', 'dotenv', 'gunicorn', 'apps',
        'product', 'manage', 'site', 'os', 'sys', 'json', 'typing', 'logging',
        'email', 'test', '__init__', '__main__', 'corsheaders',
        'django_celery_beat', 'redis', 'psycopg', 'psycopg_binary', 'whitenoise',
        'drf_spectacular', 'rest_framework_simplejwt', 'phonenumbers', 'httpx',
        'google', 'requests', 'opentelemetry', 'jwt', 'cryptography', 'kombu',
        'billiard', 'vine', 'asgiref', 'sqlparse', 'urllib3', 'certifi', 'idna',
    }
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', package) or keyword.iskeyword(package) or package in reserved:
        raise BootstrapError('Python package must be an ASCII identifier that does not shadow Python or application packages.')
    if len(package) > 63:
        raise BootstrapError('Python package must be at most 63 characters.')
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', identity.database):
        raise BootstrapError('Database name must be a lowercase PostgreSQL identifier of at most 63 characters.')
    domain = identity.domain
    labels = domain.split('.')
    if (len(domain) > 253 or len(labels) < 2 or not re.search(r'[a-zA-Z]', labels[-1])
            or any(not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label) for label in labels)):
        raise BootstrapError('Domain must be a bare DNS hostname such as acme.com, without a scheme, port, or path.')
    for relative in (f'backend/{package}', f'backend/{package}.py', package, f'{package}.py'):
        path = _safe_path(root, relative)
        if path.exists() and relative != 'backend/core':
            raise BootstrapError(f'Python package collides with an existing path: {relative}')


def _package_text(text, package):
    # Negative lookbehind protects django.core and other third-party modules.
    text = re.sub(r'(?<![\w.])core(?=[./])', lambda _: package, text)
    text = re.sub(r'(?<=backend/)core\b', lambda _: package, text)
    text = re.sub(r'\b(from|import) core\b', lambda m: m[1] + ' ' + package, text)
    return re.sub(r'(?<=-A )core\b', lambda _: package, text)


def _brand_text(text, identity):
    # Proxy headers and telemetry context keys are internal wire identifiers.
    protocol = {}
    def preserve(match):
        marker = '\x00PROTOCOL' + str(len(protocol)) + '\x00'
        protocol[marker] = match[0]
        return marker
    text = re.sub(r'(?i)(?:http_)?x[-_]mobser[-_][a-z_-]+', preserve, text)
    text = text.replace('mobser.request_id', '\x00REQUEST_ID\x00')
    text = text.replace('mobser_', identity.metric_prefix + '_')
    text = text.replace('mobser.http', identity.metric_prefix + '.http')
    text = text.replace('mobser.task', identity.metric_prefix + '.task')
    text = text.replace('mobser.node', identity.metric_prefix + '.node')
    text = text.replace('mobser', identity.slug)
    text = text.replace('Mobser', identity.name)
    text = text.replace('\x00REQUEST_ID\x00', 'mobser.request_id')
    for marker, value in protocol.items():
        text = text.replace(marker, value)
    return text


def _python_text(source, identity):
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    changes = []
    previous = None
    for token in tokens:
        replacement = token.string
        if token.type == tokenize.NAME and token.string == 'core' and previous in ('from', 'import'):
            replacement = identity.package
        elif token.type == tokenize.STRING:
            try:
                value = ast.literal_eval(token.string)
            except (ValueError, SyntaxError):
                value = None
            if isinstance(value, str):
                new = _brand_text(_package_text(value, identity.package), identity)
                if value == 'core':
                    new = identity.package
                new = new.replace('Dockerized Full-Stack Template API', identity.name + ' API')
                new = new.replace('API documentation for our Next.js + Django starter project.', 'API documentation for ' + identity.name + '.')
                new = new.replace('no-reply@' + identity.slug + '.local', 'no-reply@' + identity.domain)
                new = new.replace('admin@' + identity.slug + '.local', 'admin@' + identity.domain)
                if value != new:
                    replacement = repr(new)
            elif re.match(r'(?i)[rub]*f', token.string):
                # Slugs/package identifiers cannot introduce quotes or braces.
                replacement = _package_text(token.string, identity.package).replace('mobser-', identity.slug + '-')
        elif token.type == getattr(tokenize, 'FSTRING_MIDDLE', -1):
            replacement = _package_text(token.string, identity.package).replace('mobser-', identity.slug + '-')
        elif token.type == tokenize.COMMENT:
            replacement = _brand_text(_package_text(token.string, identity.package), identity)
        if replacement != token.string:
            start = offsets[token.start[0] - 1] + token.start[1]
            end = offsets[token.end[0] - 1] + token.end[1]
            changes.append((start, end, replacement))
        if token.type not in (tokenize.INDENT, tokenize.DEDENT, tokenize.NL, tokenize.COMMENT):
            previous = token.string
    for start, end, replacement in reversed(changes):
        source = source[:start] + replacement + source[end:]
    ast.parse(source)
    return source


def _env_text(source, identity, production):
    origin = 'https://' + identity.domain
    values = {
        'COMPOSE_PROJECT_NAME': identity.slug + ('-prod' if production else '-dev'),
        'DJANGO_SETTINGS_MODULE': identity.package + ('.settings.prod' if production else '.settings.dev'),
        'DB_NAME': identity.database, 'DB_USER': identity.database,
        'DEFAULT_FROM_EMAIL': 'no-reply@' + identity.domain,
    }
    if production:
        values.update(DOMAIN_NAME=identity.domain, ALLOWED_HOSTS=identity.domain,
                      NEXTAUTH_URL=origin, NEXT_PUBLIC_API_URL=origin + '/api',
                      CORS_ALLOWED_ORIGINS=origin, CSRF_TRUSTED_ORIGINS=origin)
    lines = []
    for line in source.splitlines():
        key = line.partition('=')[0]
        lines.append(key + '=' + values.pop(key) if key in values else line)
    lines.extend(key + '=' + value for key, value in values.items())
    return '\n'.join(lines) + '\n'


def _transform(relative, source, identity):
    if relative.endswith('.py'):
        return _python_text(source, identity)
    if relative.endswith('.json'):
        document = json.loads(source)
        if relative.startswith('frontend/package'):
            if document.get('name') != 'frontend':
                raise BootstrapError(f'Unexpected package identity in {relative}')
            document['name'] = identity.slug + '-frontend'
            if 'packages' in document:
                document['packages']['']['name'] = identity.slug + '-frontend'
        elif relative == 'backend/openapi.json':
            document['info']['title'] = identity.name + ' API'
            document['info']['description'] = 'API documentation for ' + identity.name + '.'
        else:
            def visit(value):
                if isinstance(value, str):
                    return _brand_text(value, identity)
                if isinstance(value, list):
                    return [visit(item) for item in value]
                if isinstance(value, dict):
                    return {key: visit(item) for key, item in value.items()}
                return value
            document = visit(document)
        # Match Django's canonical JSON renderer so api-check stays byte-stable.
        indent = 4 if relative == 'backend/openapi.json' else 2
        return json.dumps(document, ensure_ascii=False, indent=indent) + '\n'
    if relative.endswith(('.ts', '.tsx')):
        replacements = {
            '"Dockerized Full-Stack Template"': json.dumps(identity.name),
            '"Next.js & Django starter boilerplate with Postgres, Redis, Celery, and Caddy"': json.dumps(identity.name + ' platform powered by Next.js and Django.'),
            '"Mobser Credentials"': json.dumps(identity.name + ' Credentials'),
            '>Mobser</h1>': '>{' + json.dumps(identity.name) + '}</h1>',
            'for Mobser domain-specific': 'for {' + json.dumps(identity.name) + '} domain-specific',
            '"mobser-frontend"': json.dumps(identity.slug + '-frontend'),
            '"mobser.node"': json.dumps(identity.metric_prefix + '.node'),
            '"mobser:auth:"': json.dumps(identity.slug + ':auth:'),
            '`mobser-auth-vault:': '`' + identity.slug + '-auth-vault:',
        }
        for before, after in replacements.items():
            source = source.replace(before, after)
        return source
    if relative == 'observability/grafana/provisioning/dashboards/default.yaml':
        return source.replace(': Mobser', ': ' + json.dumps(identity.name))
    if relative == 'Makefile':
        lines = []
        for line in _package_text(source, identity.package).splitlines(keepends=True):
            match = re.fullmatch(r'(\s*@echo )"([^\n]*Mobser[^\n]*)"(\n?)', line)
            if match:
                line = match[1] + shlex.quote(_brand_text(match[2], identity)) + match[3]
            else:
                line = _brand_text(line, identity)
            lines.append(line)
        return ''.join(lines)
    source = _brand_text(_package_text(source, identity.package), identity)
    if relative in ('.env.example', '.env.prod.example'):
        source = _env_text(source, identity, relative == '.env.prod.example')
    return source


def _read_manifest(root):
    if _safe_path(root, JOURNAL).exists():
        raise BootstrapError(f'Interrupted bootstrap journal found at {JOURNAL}; recover its backups before retrying (see docs/bootstrap.md).')
    path = _safe_path(root, MANIFEST)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        if data['version'] != VERSION:
            raise ValueError('unsupported version')
        return Identity(**data['identity'])
    except (ValueError, KeyError, TypeError) as error:
        raise BootstrapError('Unrecognized bootstrap manifest; use a fresh copy.') from error


def build_plan(root, identity):
    root = Path(root).resolve()
    completed = _read_manifest(root)
    if completed:
        if completed != identity:
            raise BootstrapError('This checkout was already initialized with a different identity; use a fresh copy.')
        return Plan(identity)
    validate_identity(root, identity)
    plan = Plan(identity)
    core = _safe_path(root, 'backend/core')
    if not core.is_dir():
        raise BootstrapError('Expected starter package backend/core is missing.')
    # Refuse symlinks even in untouched members of a directory being renamed.
    for directory, dirs, files in os.walk(core, followlinks=False):
        for name in dirs + files:
            _safe_path(root, (Path(directory) / name).relative_to(root))
    files = list(FILES) + [str(path.relative_to(root)) for path in core.rglob('*.py') if '__pycache__' not in path.parts]
    markers = {
        'backend/manage.py': 'core.settings.dev',
        'backend/core/settings/base.py': 'Dockerized Full-Stack Template API',
        'frontend/src/app/layout.tsx': 'Dockerized Full-Stack Template',
        'frontend/src/app/page.tsx': '>Mobser</h1>',
        '.env.example': 'SECRET_KEY=', '.env.prod.example': 'SECRET_KEY=',
        'frontend/package.json': '"name": "frontend"',
    }
    for relative, marker in markers.items():
        path = _safe_path(root, relative)
        if not path.is_file() or marker not in path.read_text():
            raise BootstrapError(f'Expected starter marker missing in {relative}; use a fresh supported template.')
    for relative in files:
        path = _safe_path(root, relative)
        if not path.exists():
            continue
        original = path.read_bytes()
        transformed = _transform(relative, original.decode('utf-8'), identity).encode('utf-8')
        if original != transformed:
            plan.edits[relative] = transformed
            plan.originals[relative] = original
            plan.modes[relative] = stat.S_IMODE(path.stat().st_mode)
    for target, example in (('.env', '.env.example'), ('.env.prod', '.env.prod.example')):
        path = _safe_path(root, target)
        original_example = _safe_path(root, example).read_bytes()
        template = plan.edits.get(example, original_example)
        if path.exists() and path.read_bytes() not in (original_example, template):
            raise BootstrapError(f'Existing {target} is not an unchanged environment example; move it aside and use a fresh copy.')
        plan.edits[target] = template
        plan.originals[target] = path.read_bytes() if path.exists() else None
        plan.modes[target] = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    if identity.package != 'core':
        plan.moves.append(('backend/core', 'backend/' + identity.package))
    dashboard = 'observability/grafana/dashboards/mobser.json'
    if identity.slug != 'mobser' and _safe_path(root, dashboard).exists():
        target = f'observability/grafana/dashboards/{identity.slug}.json'
        if _safe_path(root, target).exists():
            raise BootstrapError(f'Dashboard target already exists: {target}')
        plan.moves.append((dashboard, target))
    plan.edits[MANIFEST] = (json.dumps({'version': VERSION, 'identity': asdict(identity)}, indent=2, ensure_ascii=False) + '\n').encode()
    plan.originals[MANIFEST] = None
    plan.modes[MANIFEST] = 0o644
    if shutil.which('git'):
        check = subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
        if check.returncode == 0 and Path(check.stdout.strip()).resolve() == root:
            plan.git_available = True
            targets = sorted(set(plan.edits) | {source for source, _ in plan.moves} | {target for _, target in plan.moves})
            result = subprocess.run(['git', '-C', str(root), 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', *targets], capture_output=True)
            if result.returncode:
                raise BootstrapError('Unable to check Git changes before bootstrap.')
            entries = result.stdout.decode('utf-8', errors='replace').split('\0')
            plan.conflicts = [entry[3:] for entry in entries if entry]
    return plan


def _atomic_write(path, data, mode):
    descriptor, temporary = tempfile.mkstemp(prefix='.bootstrap-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _destination(relative, moves):
    for source, target in moves:
        if relative == source or relative.startswith(source + '/'):
            return target + relative[len(source):]
    return relative


def apply_plan(root, plan):
    root = Path(root).resolve()
    if not plan.edits:
        return
    if plan.conflicts:
        raise BootstrapError('Dirty or untracked bootstrap targets: ' + ', '.join(plan.conflicts) + '. Commit or move your work before initializing a fresh copy.')
    journal = _safe_path(root, JOURNAL)
    if journal.exists():
        raise BootstrapError(f'Interrupted bootstrap journal found at {JOURNAL}.')
    for relative, original in plan.originals.items():
        path = _safe_path(root, relative)
        current = path.read_bytes() if path.exists() else None
        if current != original:
            raise BootstrapError(f'Target changed after preview: {relative}')
    for source, target in plan.moves:
        _safe_path(root, source)
        if _safe_path(root, target).exists():
            raise BootstrapError(f'Rename target already exists: {target}')
    journal.mkdir(mode=0o700)
    moved, written = [], []
    try:
        recovery = {'moves': plan.moves, 'files': []}
        for index, (relative, original) in enumerate(plan.originals.items()):
            backup = str(index)
            if original is not None:
                (journal / backup).write_bytes(original)
                (journal / backup).chmod(0o600)
            recovery['files'].append({'path': relative, 'backup': backup if original is not None else None, 'mode': plan.modes[relative]})
        (journal / 'recovery.json').write_text(json.dumps(recovery, indent=2) + '\n')
        for source, target in plan.moves:
            _safe_path(root, source).rename(_safe_path(root, target))
            moved.append((source, target))
        for relative, proposed in plan.edits.items():
            mode = plan.modes[relative]
            if relative in ('.env', '.env.prod'):
                values = {key: secrets.token_urlsafe(48) for key in SECRET_KEYS}
                text = proposed.decode()
                for key, value in values.items():
                    pattern = r'^' + key + r'=.*$'
                    if re.search(pattern, text, re.MULTILINE):
                        text = re.sub(pattern, lambda _: key + '=' + value, text, flags=re.MULTILINE)
                    else:
                        text += key + '=' + value + '\n'
                proposed = text.encode()
                mode = 0o600
            path = _safe_path(root, _destination(relative, plan.moves))
            written.append(relative)
            _atomic_write(path, proposed, mode)
    except BaseException as error:
        try:
            # Use a separate restoration path so a failed writer can still roll back.
            for relative in reversed(written):
                path = _safe_path(root, _destination(relative, moved))
                original = plan.originals[relative]
                if original is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_bytes(original)
                    path.chmod(plan.modes[relative])
            for source, target in reversed(moved):
                _safe_path(root, target).rename(_safe_path(root, source))
            shutil.rmtree(journal)
        except BaseException as rollback_error:
            raise BootstrapError(f'Bootstrap failed and recovery is incomplete; preserve {JOURNAL} and follow docs/bootstrap.md.') from rollback_error
        raise BootstrapError('Bootstrap failed; original files and paths were restored.') from error
    shutil.rmtree(journal)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('name', 'domain', 'package', 'database', 'slug'):
        parser.add_argument('--' + option)
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing or generating secrets.')
    parser.add_argument('--yes', action='store_true', help='Apply without a confirmation prompt.')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    try:
        completed = _read_manifest(root)
        if completed:
            supplied = {key: getattr(args, key) for key in asdict(completed) if getattr(args, key) is not None}
            if any(value != getattr(completed, key) for key, value in supplied.items()):
                raise BootstrapError('This checkout was already initialized with a different identity; use a fresh copy.')
            print('Already initialized; files and secrets are unchanged.')
            return 0
        interactive = sys.stdin.isatty()
        if not interactive:
            missing = [key for key in ('name', 'domain', 'package', 'database') if not getattr(args, key)]
            if missing:
                raise BootstrapError('Noninteractive input requires ' + ', '.join('--' + key for key in missing) + '.')
            if not args.yes and not args.dry_run:
                raise BootstrapError('Noninteractive writes require --yes; use --dry-run to preview.')
        name = args.name if args.name is not None else input('Project name: ').strip()
        domain = args.domain if args.domain is not None else input('Domain: ').strip()
        slug = args.slug or re.sub(r'[^a-z0-9]+', '-', name.lower().replace("'", '')).strip('-')
        default = slug.replace('-', '_')
        package = args.package if args.package is not None else (input(f'Python package [{default}]: ').strip() or default)
        database = args.database if args.database is not None else (input(f'Database name [{default}]: ').strip() or default)
        identity = Identity(name, domain, package, database, slug)
        plan = build_plan(root, identity)
        print(f'Project: {name}\nDomain: {domain}\nSlug: {slug}\nPython package: {package}\nDatabase: {database}')
        for source, target in plan.moves:
            print(f'  rename {source} -> {target}')
        for relative in plan.edits:
            print(f'  update {_destination(relative, plan.moves)}')
        print('Git change-history checking available.' if plan.git_available else 'Git change-history checking unavailable; file and collision checks still apply.')
        if plan.conflicts:
            print('Conflicting dirty/untracked targets: ' + ', '.join(plan.conflicts))
        if args.dry_run:
            print('Dry run: no files changed and no secrets generated.')
            return 0
        if not args.yes and input('Apply these changes? [y/N]: ').strip().lower() not in ('y', 'yes'):
            print('Cancelled; no files changed.')
            return 0
        apply_plan(root, plan)
        print('Initialized. Review .env and .env.prod, then run make build && make up.')
        return 0
    except (BootstrapError, OSError, ValueError, tokenize.TokenError, SyntaxError) as error:
        print(f'Bootstrap error: {error}', file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled; no changes applied.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
