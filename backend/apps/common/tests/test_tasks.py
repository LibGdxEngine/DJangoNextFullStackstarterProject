import os
import tempfile
import time
from datetime import timedelta
from pathlib import Path

from celery import shared_task
from django.contrib.sessions.models import Session
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.common.models import FailedTask, TaskExecution
from apps.common.tasks import (
    ConcurrentExecutionError,
    build_key,
    cleanup_expired_sessions,
    cleanup_temp_uploads,
    idempotent,
)


@shared_task(bind=True, name="tests.common.exploding_task", sensitive_args=("code",))
def exploding_task(self, challenge_id, code):
    raise ValueError("nope")


class CleanupExpiredSessionsTests(TestCase):
    def test_clears_only_expired_sessions(self):
        Session.objects.create(
            session_key="expired-key",
            session_data="data",
            expire_date=timezone.now() - timedelta(days=1),
        )
        Session.objects.create(
            session_key="live-key",
            session_data="data",
            expire_date=timezone.now() + timedelta(days=1),
        )

        self.assertEqual(cleanup_expired_sessions(), 1)

        self.assertFalse(Session.objects.filter(session_key="expired-key").exists())
        self.assertTrue(Session.objects.filter(session_key="live-key").exists())


class CleanupTempUploadsTests(TestCase):
    def _age(self, path, hours):
        stamp = time.time() - (hours * 3600)
        os.utime(path, (stamp, stamp))

    def test_removes_only_stale_files(self):
        with tempfile.TemporaryDirectory() as media_root:
            tmp_dir = Path(media_root) / "tmp"
            tmp_dir.mkdir()

            stale = tmp_dir / "stale.bin"
            stale.write_text("old")
            self._age(stale, 48)

            fresh = tmp_dir / "fresh.bin"
            fresh.write_text("new")

            with override_settings(MEDIA_ROOT=media_root, TEMP_UPLOAD_RETENTION_HOURS=24):
                removed = cleanup_temp_uploads()

            self.assertEqual(removed, 1)
            self.assertFalse(stale.exists())
            self.assertTrue(fresh.exists())

    def test_sweeps_nested_directories(self):
        with tempfile.TemporaryDirectory() as media_root:
            nested = Path(media_root) / "tmp" / "nested"
            nested.mkdir(parents=True)

            stale = nested / "stale.bin"
            stale.write_text("old")
            self._age(stale, 48)

            with override_settings(MEDIA_ROOT=media_root, TEMP_UPLOAD_RETENTION_HOURS=24):
                removed = cleanup_temp_uploads()

            self.assertEqual(removed, 1)
            self.assertFalse(stale.exists())

    def test_no_op_when_staging_directory_missing(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, TEMP_UPLOAD_RETENTION_HOURS=24):
                self.assertEqual(cleanup_temp_uploads(), 0)


class IdempotencyGuardTests(TestCase):
    def setUp(self):
        self.key = build_key("tests", "unit-of-work")

    def _run(self, calls):
        with idempotent(self.key, task_name="tests.guard") as guard:
            if guard.is_duplicate:
                return guard.result
            calls.append(1)
            guard.record("done")
            return guard.result

    def test_second_delivery_skips_the_side_effect_and_replays_the_result(self):
        calls = []

        self.assertEqual(self._run(calls), "done")
        self.assertEqual(self._run(calls), "done")

        self.assertEqual(len(calls), 1)
        self.assertEqual(TaskExecution.objects.filter(key=self.key).count(), 1)
        self.assertEqual(
            TaskExecution.objects.get(key=self.key).status, TaskExecution.Status.SUCCEEDED
        )

    def test_failed_attempt_is_allowed_to_run_again(self):
        with self.assertRaises(ValueError):
            with idempotent(self.key, task_name="tests.guard"):
                raise ValueError("boom")

        self.assertEqual(
            TaskExecution.objects.get(key=self.key).status, TaskExecution.Status.FAILED
        )

        with idempotent(self.key, task_name="tests.guard") as guard:
            self.assertFalse(guard.is_duplicate)

    def test_a_concurrent_holder_of_the_key_is_rejected(self):
        with idempotent(self.key, task_name="tests.guard"):
            with self.assertRaises(ConcurrentExecutionError):
                with idempotent(self.key, task_name="tests.guard"):
                    pass

    def test_lock_is_released_once_the_guard_exits(self):
        with idempotent(self.key, task_name="tests.guard"):
            pass

        with idempotent(self.key, task_name="tests.guard") as guard:
            self.assertTrue(guard.is_duplicate)


class DeadLetterTests(TestCase):
    def test_exhausted_task_is_recorded_with_secrets_redacted(self):
        exploding_task.apply(args=["challenge-1", "123456"])

        failure = FailedTask.objects.get()
        self.assertEqual(failure.task_name, "tests.common.exploding_task")
        self.assertEqual(failure.exception_class, "ValueError")
        self.assertEqual(failure.status, FailedTask.Status.NEW)
        # The OTP was passed positionally and must not survive into the dead letter.
        self.assertEqual(failure.args, ["challenge-1", "***"])
        self.assertNotIn("123456", failure.traceback)
