from django.urls import path
from .views import NotificationListView, NotificationMarkReadView

app_name = 'notifications'

urlpatterns = [
    path('', NotificationListView.as_view(), name='notification_list'),
    path('<uuid:pk>/read/', NotificationMarkReadView.as_view(), name='notification_mark_read'),
]
