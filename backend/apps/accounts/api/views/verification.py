from apps.common.throttling import BaselineThrottle, OperationThrottle
from core.api_errors import validation_error_response
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils.decorators import method_decorator
from apps.accounts.services.verification import confirm_signup
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.api.serializers import (
    VerificationConfirmSerializer,
    VerificationResendSerializer,
)
from apps.accounts.models import User, UserStatus, VerificationPurpose
from apps.accounts.services import (
    resend_verification_challenge,
    issue_tokens_for_user,
)
from apps.messaging.tasks import send_verification_message


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class VerificationConfirmView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'confirm'

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
            challenge = confirm_signup(challenge_id=challenge_id, code=code)
            token_data = issue_tokens_for_user(challenge.user)
            return Response(
                {"message": "Phone verified successfully. Welcome!", **token_data},
                status=status.HTTP_200_OK,
            )
        except ValidationError as exc:
            return validation_error_response(exc)


class VerificationResendView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'resend'

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
            return validation_error_response(exc)
