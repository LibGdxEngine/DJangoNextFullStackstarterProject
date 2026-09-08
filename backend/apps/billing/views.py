from rest_framework import generics, permissions
from .models import Plan, Subscription
from .serializers import PlanSerializer, SubscriptionSerializer

class PlanListView(generics.ListAPIView):
    """
    Public listing of available subscription plans.
    """
    queryset = Plan.objects.filter(is_active=True)
    serializer_class = PlanSerializer
    permission_classes = [permissions.AllowAny]


class SubscriptionListView(generics.ListAPIView):
    """
    Listing of subscriptions for the current user's organizations.
    """
    serializer_class = SubscriptionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Subscription.objects.filter(customer__organization__memberships__user=user)
