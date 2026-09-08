from django.urls import path, include

app_name = "accounts"

urlpatterns = [
    path("", include("apps.accounts.api.urls", namespace="api")),
]
