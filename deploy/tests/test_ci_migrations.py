import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('ci_migrations', Path(__file__).resolve().parents[2] / 'scripts/ci-migrations.py')
migrations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrations)


class MigrationPolicyTests(unittest.TestCase):
    def source(self, operation):
        return 'from django.db import migrations, models\nclass Migration(migrations.Migration):\n    dependencies = []\n    operations = [' + operation + ']\n'

    def test_nullable_addition(self):
        migrations.validate_migration(self.source('migrations.AddField(model_name="user", name="nickname", field=models.CharField(max_length=80, null=True))'))

    def test_database_default_addition(self):
        migrations.validate_migration(self.source('migrations.AddField(model_name="user", name="count", field=models.IntegerField(db_default=0))'))

    def test_python_default_is_not_database_default(self):
        with self.assertRaises(ValueError):
            migrations.validate_migration(self.source('migrations.AddField(model_name="user", name="count", field=models.IntegerField(default=0))'))

    def test_destructive_and_custom_operations(self):
        for operation in ('RemoveField', 'DeleteModel', 'AlterField', 'RenameField', 'RunPython', 'RunSQL', 'SeparateDatabaseAndState'):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                migrations.validate_migration(self.source(f'migrations.{operation}(name="unsafe")'))

    def test_executable_module_is_rejected(self):
        with self.assertRaises(ValueError):
            migrations.validate_migration(self.source('') + 'print("side effect")\n')

    def test_computed_operations_are_rejected(self):
        with self.assertRaises(ValueError):
            migrations.validate_migration(self.source('custom_operation()'))

    def test_unique_addition_is_rejected(self):
        with self.assertRaises(ValueError):
            migrations.validate_migration(self.source('migrations.AddField(model_name="user", name="nickname", field=models.CharField(null=True, unique=True))'))

    def test_failed_release_migration_cannot_be_hidden_by_unrelated_push(self):
        # Commit A introduced RunSQL and failed its gate. Commit B only changes
        # application code; a comparison against B's parent would be empty.
        path = 'backend/apps/example/migrations/0002_failed_release.py'
        def cumulative_diff(base, head='HEAD'):
            return [('A', path)] if base == migrations.REVIEWED_BASELINE else []
        with mock.patch.object(migrations, 'changed_migrations', side_effect=cumulative_diff) as diff:
            with mock.patch.object(Path, 'read_text', return_value=self.source('migrations.RunSQL(sql="DROP TABLE users")')):
                with self.assertRaisesRegex(ValueError, 'RunSQL'):
                    migrations.main()
        diff.assert_called_once_with(migrations.REVIEWED_BASELINE)

    def test_baseline_migrations_cannot_be_modified(self):
        with mock.patch.object(migrations, 'changed_migrations', return_value=[('M', 'backend/apps/example/migrations/0001_initial.py')]):
            with self.assertRaisesRegex(ValueError, 'existing migrations'):
                migrations.main()
