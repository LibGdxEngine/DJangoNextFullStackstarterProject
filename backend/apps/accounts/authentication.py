from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.exceptions import InvalidToken
from apps.accounts.models import AuthSession
from apps.accounts.services.authentication import _session_id, validate_session


class VersionedJWTAuthentication(JWTAuthentication):
    """Require an eligible user and a live persisted session on every request."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        if token.get("scope") == "phone_onboarding":
            allowed = {
                ("GET", "auth:me"),
                ("POST", "auth:phone_change_initiate"),
                ("POST", "auth:phone_change_confirm"),
            }
            match = request.resolver_match
            if (request.method, match.view_name if match else None) not in allowed:
                raise PermissionDenied("Phone verification is required.")
        return user, token

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        try:
            session = AuthSession.objects.get(pk=_session_id(validated_token))
        except AuthSession.DoesNotExist as exc:
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
