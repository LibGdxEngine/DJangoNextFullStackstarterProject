from rest_framework import generics, permissions
from .models import AuditLog
from .serializers import AuditLogSerializer

class AuditLogListView(generics.ListAPIView):
    """
    List audit logs. Available to authenticated staff users or for the user's own actions.
    """
    serializer_class = AuditLogSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.is_staff:
            return AuditLog.objects.all()
        return AuditLog.objects.filter(actor=user)
