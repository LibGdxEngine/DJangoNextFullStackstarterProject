from django.urls import path
from .views import PlanListView, SubscriptionListView

app_name = 'billing'

urlpatterns = [
    path('plans/', PlanListView.as_view(), name='plan_list'),
    path('subscriptions/', SubscriptionListView.as_view(), name='subscription_list'),
]
