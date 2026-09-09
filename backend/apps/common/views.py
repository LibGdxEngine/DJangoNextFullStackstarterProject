from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.core.cache import cache

@api_view(['GET'])
@permission_classes([AllowAny])
def hello_world(request):
    """
    Simple hello world API endpoint.
    """
    return Response({
        "message": "Hello from the Django backend!",
        "status": "success"
    })

@api_view(['GET'])
@permission_classes([AllowAny])
def system_status(request):
    """Read-only status; heartbeat covers scheduler → broker → worker → cache."""
    from apps.common.health import dependency_status
    from apps.common.tasks import BEAT_HEARTBEAT_CACHE_KEY

    status = dependency_status()
    last_seen = None
    if status['redis'] == 'up':
        try:
            last_seen = cache.get(BEAT_HEARTBEAT_CACHE_KEY)
        except Exception:
            status['redis'] = 'down'
    background = 'up' if last_seen else 'down'
    status['celery'] = background
    status['beat'] = {'status': background, 'last_seen': last_seen}
    response = Response(status, status=200 if status['database'] == status['redis'] == 'up' else 503)
    response['Cache-Control'] = 'no-store'
    return response
