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

urlpatterns = [
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
    path('api/common/', include('apps.common.urls', namespace='common')),
    path('api/accounts/', include('apps.accounts.urls', namespace='accounts')),
    path('api/organizations/', include('apps.organizations.urls', namespace='organizations')),
    path('api/billing/', include('apps.billing.urls', namespace='billing')),
    path('api/notifications/', include('apps.notifications.urls', namespace='notifications')),
    path('api/audit/', include('apps.audit.urls', namespace='audit')),
]
