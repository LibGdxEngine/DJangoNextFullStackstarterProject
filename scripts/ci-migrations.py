#!/usr/bin/env python3
"""Conservative additive-migration gate; this does not replace CODEOWNER review."""
import ast
from pathlib import Path
import subprocess
import sys

# Advancing this requires reviewed schema and rollback compatibility on the host.
REVIEWED_BASELINE = 'b56dce1ce5b76aaaf2bf54b73e473609f30299a8'


def validate_migration(source):
    tree = ast.parse(source)
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
    if len(classes) != 1 or classes[0].name != 'Migration':
        raise ValueError('expected one literal Migration class')
    for node in tree.body:
        if not isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef)):
            raise ValueError('executable module statements need manual migration review')
    migration = classes[0]
    if migration.decorator_list or len(migration.bases) != 1 or ast.unparse(migration.bases[0]) != 'migrations.Migration':
        raise ValueError('custom migration classes need manual review')
    assignments = {}
    for node in migration.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            raise ValueError('only literal migration attributes are supported')
        assignments[node.targets[0].id] = node.value
    if not set(assignments) <= {'initial', 'dependencies', 'operations', 'atomic'}:
        raise ValueError('unknown migration attribute')
    operations = assignments.get('operations')
    if not isinstance(operations, (ast.List, ast.Tuple)):
        raise ValueError('operations must be a literal list')
    for operation in operations.elts:
        if not isinstance(operation, ast.Call) or not isinstance(operation.func, ast.Attribute) or not isinstance(operation.func.value, ast.Name) or operation.func.value.id != 'migrations':
            raise ValueError('custom or computed operations are not supported')
        if operation.func.attr not in {'CreateModel', 'AddField', 'AddIndex'}:
            raise ValueError(f'{operation.func.attr} is not an approved additive operation')
        if operation.args or any(keyword.arg is None for keyword in operation.keywords):
            raise ValueError('migration operation arguments must be explicit keywords')
        keywords = {keyword.arg: keyword.value for keyword in operation.keywords}
        if operation.func.attr == 'AddField':
            field = keywords.get('field')
            if not isinstance(field, ast.Call) or not isinstance(field.func, ast.Attribute) or not isinstance(field.func.value, ast.Name) or field.func.value.id != 'models':
                raise ValueError('AddField requires a standard Django field')
            options = {keyword.arg: keyword.value for keyword in field.keywords}
            nullable = isinstance(options.get('null'), ast.Constant) and options['null'].value is True
            default = options.get('db_default')
            safe_default = isinstance(default, ast.Constant) and default.value is not None
            if not nullable and not safe_default:
                raise ValueError('AddField requires null=True or a literal non-null db_default')
            if any(isinstance(options.get(key), ast.Constant) and options[key].value is True for key in ('unique', 'primary_key')):
                raise ValueError('new uniqueness requirements need manual review')


def changed_migrations(base, head='HEAD'):
    output = subprocess.check_output(['git', 'diff', '--name-status', '--no-renames', base, head, '--', 'backend'], text=True)
    changes = []
    for line in output.splitlines():
        status, path = line.split('\t', 1)
        if '/migrations/' in path and path.endswith('.py') and not path.endswith('/__init__.py'):
            changes.append((status, path))
    return changes


def main():
    # A failed release may leave its migrations unexecuted. Comparing only the
    # latest push would allow an unrelated follow-up to conceal that migration.
    changes = changed_migrations(REVIEWED_BASELINE)
    for status, path in changes:
        if status != 'A':
            raise ValueError(f'{path}: existing migrations cannot be edited or removed')
        try:
            validate_migration(Path(path).read_text())
        except (SyntaxError, ValueError) as exc:
            raise ValueError(f'{path}: {exc}') from exc
    print(f'Migration compatibility gate passed ({len(changes)} changed migrations; reviewed baseline {REVIEWED_BASELINE}).')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f'Migration gate failed: {exc}. Split expand/contract changes and obtain a reviewed admin migration plan.', file=sys.stderr)
        sys.exit(1)
