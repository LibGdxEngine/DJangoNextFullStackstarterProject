"""Load instrumentation inside workers, before Django constructs its handler."""

from core.logging import JsonFormatter

preload_app = False
accesslog = '-'
errorlog = '-'
# Gunicorn access records deliberately exclude request targets and credentials.
access_log_format = '%(m)s %(s)s %(D)s'
logconfig_dict = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'json': {'()': JsonFormatter}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'stream': 'ext://sys.stdout', 'formatter': 'json'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        'gunicorn.error': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
        'gunicorn.access': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}


def post_fork(server, worker):
    from core.telemetry import initialize
    initialize()


def worker_exit(server, worker):
    from core.telemetry import shutdown
    shutdown()
