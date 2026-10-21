from rest_framework.routers import DefaultRouter

from .views import AgentRunViewSet

app_name = 'browser_agent'

router = DefaultRouter()
router.register('runs', AgentRunViewSet, basename='run')

urlpatterns = router.urls
