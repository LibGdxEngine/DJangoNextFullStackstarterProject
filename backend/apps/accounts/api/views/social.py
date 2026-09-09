from core.api_errors import error_response
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.api.serializers import SocialAuthSerializer
from apps.accounts.services import (
    authenticate_with_social_provider,
    get_enabled_providers,
    ProviderNotConfiguredError,
    SocialAuthError,
)


class SocialProvidersView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"providers": get_enabled_providers()}, status=status.HTTP_200_OK)


class SocialAuthView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, provider):
        serializer = SocialAuthSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            tokens = authenticate_with_social_provider(
                provider=provider,
                token=serializer.validated_data["token"],
            )
            return Response(tokens, status=status.HTTP_200_OK)
        except ProviderNotConfiguredError as exc:
            return error_response(
                "PROVIDER_NOT_CONFIGURED", str(exc),
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SocialAuthError as exc:
            return error_response(
                "SOCIAL_AUTH_FAILED", str(exc),
                status=status.HTTP_401_UNAUTHORIZED,
            )
