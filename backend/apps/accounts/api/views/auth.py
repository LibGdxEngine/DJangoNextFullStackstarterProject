from django.db import transaction
from django.utils.decorators import method_decorator
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from apps.accounts.api.serializers.auth import SessionTokenRefreshSerializer
from apps.accounts.services.authentication import SessionRefreshToken
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from apps.common.rate_limits import enforce_limits
from apps.common.throttling import BaselineThrottle, OperationThrottle
from core.api_errors import validation_error_response, error_response
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.api.serializers import (
    SignupSerializer,
    LoginSerializer,
    LogoutSerializer,
    PasswordForgotSerializer,
    PasswordResetVerifySerializer,
    PasswordResetConfirmSerializer,
    PasswordChangeSerializer,
)
from apps.accounts.phone import mask_phone
from apps.accounts.services import (
    signup_user,
    authenticate_user,
    issue_tokens_for_user,
    revoke_refresh_token,
    PhoneVerificationRequiredError,
    initiate_password_reset,
    verify_password_reset_code,
    reset_password_with_token,
    change_password,
)


class SignupView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'signup'

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = signup_user(
                email=serializer.validated_data["email"],
                phone=serializer.validated_data["phone"],
                password=serializer.validated_data["password"],
                first_name=serializer.validated_data.get("first_name", ""),
                last_name=serializer.validated_data.get("last_name", ""),
            )
            return Response(result, status=status.HTTP_201_CREATED)
        except ValidationError as exc:
            return validation_error_response(exc)


class LoginView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'login'

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        identifier = serializer.validated_data["identifier"]
        password = serializer.validated_data["password"]

        try:
            user = authenticate_user(identifier=identifier, password=password, request=request)
            tokens = issue_tokens_for_user(user)
            return Response(tokens, status=status.HTTP_200_OK)
        except PhoneVerificationRequiredError as exc:
            return error_response(
                "PHONE_VERIFICATION_REQUIRED", exc.message,
                context={"email": exc.user.email, "phone": mask_phone(exc.user.phone)},
                status=status.HTTP_403_FORBIDDEN,
            )
        except ValidationError as exc:
            return error_response(
                "INVALID_CREDENTIALS", exc.message if hasattr(exc, "message") else str(exc),
                status=status.HTTP_401_UNAUTHORIZED,
            )


class LogoutView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'logout'

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            revoke_refresh_token(serializer.validated_data["refresh"])
            return Response({"message": "Logged out successfully."}, status=status.HTTP_200_OK)
        except ValidationError as exc:
            return validation_error_response(exc)


class PasswordForgotView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'forgot'

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        response = initiate_password_reset(serializer.validated_data["identifier"])
        return Response(response, status=status.HTTP_200_OK)


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class PasswordResetVerifyView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'confirm'

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            reset_token = verify_password_reset_code(
                challenge_id=str(serializer.validated_data["challenge_id"]),
                code=serializer.validated_data["code"],
            )
            return Response(
                {"message": "Code verified successfully.", "reset_token": reset_token},
                status=status.HTTP_200_OK,
            )
        except ValidationError as exc:
            return validation_error_response(exc)


class PasswordResetConfirmView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'reset'

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            reset_password_with_token(
                reset_token=serializer.validated_data["reset_token"],
                new_password=serializer.validated_data["new_password"],
            )
            return Response(
                {"message": "Password has been reset successfully. You can now log in with your new password."},
                status=status.HTTP_200_OK,
            )
        except ValidationError as exc:
            return validation_error_response(exc)


class PasswordChangeView(APIView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = 'sensitive'

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            change_password(
                user=request.user,
                old_password=serializer.validated_data["old_password"],
                new_password=serializer.validated_data["new_password"],
            )
            return Response({"message": "Password changed successfully."}, status=status.HTTP_200_OK)
        except ValidationError as exc:
            return validation_error_response(exc)


class RateLimitedTokenRefreshSerializer(SessionTokenRefreshSerializer):
    token_class = SessionRefreshToken

    def validate(self, attrs):
        token = self.token_class(attrs["refresh"])
        subject = token.get(jwt_settings.USER_ID_CLAIM)
        if subject is not None:
            enforce_limits([("refresh_subject", str(subject))])
        return super().validate(attrs)


class RateLimitedTokenRefreshView(TokenRefreshView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = "refresh"
    serializer_class = RateLimitedTokenRefreshSerializer


class RateLimitedTokenVerifyView(TokenVerifyView):
    throttle_classes = [BaselineThrottle, OperationThrottle]
    rate_limit_operation = "verify"
