from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.api.serializers import (
    VerificationConfirmSerializer,
    VerificationResendSerializer,
)
from apps.accounts.models import UserStatus, VerificationPurpose
from apps.accounts.services import (
    verify_challenge_code,
    resend_verification_challenge,
    issue_tokens_for_user,
)
from apps.messaging.tasks import send_verification_message


class VerificationConfirmView(APIView):
    """
    Confirms an OTP verification challenge.
    For signup verification: marks user ACTIVE, sets phone_verified_at, and issues JWT tokens directly.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerificationConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        challenge_id = str(serializer.validated_data["challenge_id"])
        code = serializer.validated_data["code"]

        try:
            challenge = verify_challenge_code(challenge_id=challenge_id, code=code)
            user = challenge.user

            if challenge.purpose == VerificationPurpose.SIGNUP:
                user.phone_verified_at = timezone.now()
                user.status = UserStatus.ACTIVE
                user.save(update_fields=["phone_verified_at", "status", "updated_at"])

                # Issue JWT tokens immediately so the user doesn't have to log in again
                token_data = issue_tokens_for_user(user)
                return Response(
                    {
                        "message": "Phone verified successfully. Welcome!",
                        **token_data,
                    },
                    status=status.HTTP_200_OK,
                )

            return Response(
                {
                    "message": "Verification confirmed successfully.",
                    "purpose": challenge.purpose,
                },
                status=status.HTTP_200_OK,
            )
        except ValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class VerificationResendView(APIView):
    """
    Resends OTP challenge respecting cooldown and maximum resend limits.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerificationResendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        challenge_id = str(serializer.validated_data["challenge_id"])

        try:
            challenge, new_code = resend_verification_challenge(challenge_id=challenge_id)

            transaction.on_commit(
                lambda: send_verification_message.delay(str(challenge.id), new_code)
            )

            return Response(
                {
                    "message": "Verification code resent successfully.",
                    "expires_in": 300,
                },
                status=status.HTTP_200_OK,
            )
        except ValidationError as exc:
            return Response(
                {"detail": exc.message if hasattr(exc, "message") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
