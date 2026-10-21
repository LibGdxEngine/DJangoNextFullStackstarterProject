from rest_framework.routers import DefaultRouter

from .views import AgentRoleViewSet, AgentRunViewSet, TaskTemplateViewSet

app_name = 'browser_agent'

router = DefaultRouter()
router.register('runs', AgentRunViewSet, basename='run')
router.register('roles', AgentRoleViewSet, basename='role')
router.register('task-templates', TaskTemplateViewSet, basename='task-template')

urlpatterns = router.urls
