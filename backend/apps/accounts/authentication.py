from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from apps.accounts.models import UserStatus


class VersionedJWTAuthentication(JWTAuthentication):
    """
    Custom JWT Authentication that verifies token_version claim against user.token_version.
    Whenever user.token_version increments (e.g. password reset, phone change, deletion pending,
    manual session revocation), existing JWT access & refresh tokens become invalid immediately.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        token_version = validated_token.get("token_version")
        if token_version is not None and token_version != user.token_version:
            raise InvalidToken("Token has been revoked due to session invalidation.")

        if user.status == UserStatus.BLOCKED:
            raise AuthenticationFailed("User account is blocked.")

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
