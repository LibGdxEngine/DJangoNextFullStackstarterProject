"""Session authorization for the private Grafana proxy, and infrastructure probes."""

from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from apps.accounts.models import UserStatus
from apps.common.health import dependency_status


@never_cache
@require_GET
def observability_auth(request):
    # AuthenticationMiddleware loads the current DB user on every request. JWT and
    # client-supplied auth-proxy headers are intentionally not authentication here.
    try:
        user = request.user
        if not user.is_authenticated:
            return HttpResponseRedirect('/admin/login/?next=/observability/')
        if not (user.is_active and user.is_staff and user.status == UserStatus.ACTIVE):
            return HttpResponse(status=403)
        response = HttpResponse(status=200)
        response['X-WEBAUTH-USER'] = str(user.pk)
        return response
    except Exception:
        return HttpResponse(status=503)


@never_cache
@require_GET
def health_live(request):
    return JsonResponse({'status': 'up'})


@never_cache
@require_GET
def health_ready(request):
    status = dependency_status()
    return JsonResponse(status, status=200 if all(value == 'up' for value in status.values()) else 503)
