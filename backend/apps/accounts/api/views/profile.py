from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.api.serializers import (
    UserProfileSerializer,
    PhoneChangeInitiateSerializer,
    PhoneChangeConfirmSerializer,
    EmailChangeSerializer,
    AccountDeletionInitiateSerializer,
)
from apps.accounts.services import (
    update_profile,
    initiate_phone_change,
    confirm_phone_change,
    change_email,
    initiate_account_deletion,
)


class UserProfileView(APIView):
    """
    Retrieve or update authenticated user profile, or initiate sensitive step-up account deletion.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserProfileSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        serializer = UserProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        user = update_profile(
            request.user,
            first_name=serializer.validated_data.get("first_name"),
            last_name=serializer.validated_data.get("last_name"),
            bio=serializer.validated_data.get("bio"),
            avatar_url=serializer.validated_data.get("avatar_url"),
        )
        return Response(UserProfileSerializer(user).data, status=status.HTTP_200_OK)

    def delete(self, request):
        serializer = AccountDeletionInitiateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = initiate_account_deletion(
                user=request.user,
                password=serializer.validated_data["password"],
            )
            return Response(result, status=status.HTTP_200_OK)
        except ValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class PhoneChangeInitiateView(APIView):
    """
    Phase 1: Validate new phone number and issue OTP challenge to the NEW number.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PhoneChangeInitiateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = initiate_phone_change(
                user=request.user,
                new_phone=serializer.validated_data["new_phone"],
            )
            return Response(result, status=status.HTTP_200_OK)
        except ValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class PhoneChangeConfirmView(APIView):
    """
    Phase 2: Confirm OTP received on the new phone, update user phone number, and rotate sessions.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PhoneChangeConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            confirm_phone_change(
                user=request.user,
                challenge_id=str(serializer.validated_data["challenge_id"]),
                code=serializer.validated_data["code"],
            )
            return Response({"message": "Phone number updated successfully."}, status=status.HTTP_200_OK)
        except ValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class EmailChangeView(APIView):
    """
    Update email address requiring password verification.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = EmailChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            change_email(
                user=request.user,
                new_email=serializer.validated_data["new_email"],
                password=serializer.validated_data["password"],
            )
            return Response(
                {"message": "Email address updated successfully."},
                status=status.HTTP_200_OK,
            )
        except ValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
