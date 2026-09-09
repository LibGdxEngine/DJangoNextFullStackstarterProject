from core.api_errors import validation_error_response, error_response
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView
from apps.accounts.api.serializers.auth import SessionTokenRefreshSerializer

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


class SessionTokenRefreshView(TokenRefreshView):
    serializer_class = SessionTokenRefreshSerializer


class SignupView(APIView):
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
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            revoke_refresh_token(serializer.validated_data["refresh"])
            return Response({"message": "Logged out successfully."}, status=status.HTTP_200_OK)
        except ValidationError as exc:
            return validation_error_response(exc)


class PasswordForgotView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        response = initiate_password_reset(serializer.validated_data["identifier"])
        return Response(response, status=status.HTTP_200_OK)


class PasswordResetVerifyView(APIView):
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
