import logging
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.db import connection
from django.core.cache import cache

logger = logging.getLogger(__name__)

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
    """
    Checks the health of Database, Redis (via cache backend), and Celery task execution.
    """
    status = {
        "database": "down",
        "redis": "down",
        "celery": "unknown"
    }

    # 1. Check Database connection
    try:
        connection.ensure_connection()
        status["database"] = "up"
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        status["database"] = f"down: {str(e)}"

    # 2. Check Redis connection
    try:
        cache.set("health_check_key", "ok", timeout=5)
        val = cache.get("health_check_key")
        if val == "ok":
            status["redis"] = "up"
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")
        status["redis"] = f"down: {str(e)}"

    # 3. Trigger async Celery task
    try:
        from apps.notifications.tasks import test_celery_task
        task = test_celery_task.delay(4, 5)
        status["celery"] = {
            "status": "triggered",
            "task_id": task.id
        }
    except Exception as e:
        logger.error(f"Celery task trigger failed: {e}")
        status["celery"] = f"failed to trigger: {str(e)}"

    return Response(status)
