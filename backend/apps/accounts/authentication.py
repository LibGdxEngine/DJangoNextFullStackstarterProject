from django.core.exceptions import ValidationError
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from apps.accounts.models import AuthSession, UserStatus
from apps.accounts.services.authentication import validate_session


class VersionedJWTAuthentication(JWTAuthentication):
    """
    Custom JWT Authentication that verifies token_version claim against user.token_version.
    Whenever user.token_version increments (e.g. password reset, phone change, deletion pending,
    manual session revocation), existing JWT access & refresh tokens become invalid immediately.
    """

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        if token.get("scope") == "phone_onboarding":
            match = request.resolver_match
            allowed = {
                "me": {"GET", "HEAD", "OPTIONS"},
                "phone_change_initiate": {"POST", "OPTIONS"},
                "phone_change_confirm": {"POST", "OPTIONS"},
                "verification_confirm": {"POST", "OPTIONS"},
                "verification_resend": {"POST", "OPTIONS"},
                "logout": {"POST", "OPTIONS"},
            }
            if (match is None or match.namespace not in {"auth", "accounts:api"}
                    or request.method not in allowed.get(match.url_name, set())):
                raise PermissionDenied("Phone verification is required for this action.")
        return user, token

    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        token_version = validated_token.get("token_version")
        if token_version is not None and token_version != user.token_version:
            raise InvalidToken("Token has been revoked due to session invalidation.")

        if user.status == UserStatus.BLOCKED:
            raise AuthenticationFailed("User account is blocked.")

        if "sid" in validated_token:
            try:
                session = AuthSession.objects.get(pk=validated_token["sid"])
            except (AuthSession.DoesNotExist, ValidationError, ValueError, TypeError) as exc:
                raise InvalidToken("Session does not exist.") from exc
            validate_session(validated_token, user, session)

        return user


try:
    from drf_spectacular.extensions import OpenApiAuthenticationExtension

    class VersionedJWTScheme(OpenApiAuthenticationExtension):
        target_class = "apps.accounts.authentication.VersionedJWTAuthentication"
        name = "jwtAuth"

        def get_security_definition(self, auto_schema):
            return {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
            }
except ImportError:
    pass
