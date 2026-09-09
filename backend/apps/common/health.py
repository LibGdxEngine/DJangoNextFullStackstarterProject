"""Small dependency probes with independent, bounded production connections."""

from django.conf import settings
from django.core.cache import cache
from django.db import connection


def dependency_status():
    status = {'database': 'down', 'redis': 'down'}
    try:
        if connection.vendor == 'postgresql':
            import psycopg
            params = connection.get_connection_params()
            params.update(connect_timeout=2, options='-c statement_timeout=2000', autocommit=True)
            # Do not trust an existing request connection: a half-open socket can
            # otherwise stall readiness indefinitely despite statement_timeout.
            with psycopg.connect(**params) as probe:
                with probe.cursor() as cursor:
                    cursor.execute('SELECT 1')
                    cursor.fetchone()
        else:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        status['database'] = 'up'
    except Exception:
        pass
    try:
        configuration = settings.CACHES['default']
        if configuration['BACKEND'] == 'django.core.cache.backends.redis.RedisCache':
            from redis import Redis
            from redis.backoff import NoBackoff
            from redis.retry import Retry
            location = configuration['LOCATION']
            if isinstance(location, (list, tuple)):
                location = location[0]
            with Redis.from_url(location, socket_connect_timeout=2, socket_timeout=2,
                                retry=Retry(NoBackoff(), 0)) as probe:
                if probe.ping():
                    status['redis'] = 'up'
        else:
            cache.set('health_check_key', 'ok', timeout=5)
            if cache.get('health_check_key') == 'ok':
                status['redis'] = 'up'
    except Exception:
        pass
    return status
