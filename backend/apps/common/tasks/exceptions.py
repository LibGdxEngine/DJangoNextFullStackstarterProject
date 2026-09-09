class TaskError(Exception):
    """Base class for errors raised deliberately inside a background task."""


class RetryableTaskError(TaskError):
    """A transient failure that is worth retrying with backoff."""


class PermanentTaskError(TaskError):
    """A failure that cannot succeed on retry, so it is dead-lettered immediately."""


class ConcurrentExecutionError(RetryableTaskError):
    """Another worker currently holds the idempotency lock for this key."""
