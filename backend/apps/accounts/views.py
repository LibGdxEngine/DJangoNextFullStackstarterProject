from rest_framework import generics, permissions
from rest_framework.response import Response
from .serializers import UserProfileSerializer

class UserProfileView(generics.RetrieveUpdateAPIView):
    """
    Get or update the current authenticated user's profile.
    """
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user
