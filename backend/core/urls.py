from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)
from apps.common.views import hello_world, system_status
from apps.common.observability import health_live, health_ready, observability_auth

from core.schema import annotate_views

annotate_views()

urlpatterns = [
    path('internal/observability/auth/', observability_auth, name='observability_auth'),
    path('api/health/live/', health_live, name='health_live'),
    path('api/health/ready/', health_ready, name='health_ready'),
    # Django Admin
    path('admin/', admin.site.urls),

    # OpenAPI Schema & Interactive Documentation
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # Backward-compatible API roots
    path('api/hello/', hello_world, name='api_hello'),
    path('api/status/', system_status, name='api_status'),
    path('api/token/', TokenObtainPairView.as_view(), name='api_token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='api_token_refresh'),
    path('api/token/verify/', TokenVerifyView.as_view(), name='api_token_verify'),

    # Modular Platform App Routes
    path('api/v1/auth/', include('apps.accounts.api.urls', namespace='auth')),
    path('api/v1/webhooks/hireagents/', include('apps.integrations.hireagents.urls', namespace='hireagents-webhooks')),
    path('api/common/', include('apps.common.urls', namespace='common')),
    path('api/accounts/', include('apps.accounts.urls', namespace='accounts')),
    path('api/organizations/', include('apps.organizations.urls', namespace='organizations')),
    path('api/billing/', include('apps.billing.urls', namespace='billing')),
    path('api/notifications/', include('apps.notifications.urls', namespace='notifications')),
    path('api/audit/', include('apps.audit.urls', namespace='audit')),
]
