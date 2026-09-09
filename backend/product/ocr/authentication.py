import hashlib
import hmac
import uuid

from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.models import UserStatus
from apps.organizations.models import OrganizationMember
from .models import OCRAPIKey


def eligible_user(user):
    return user is not None and user.is_active and user.status == UserStatus.ACTIVE and user.phone_verified_at is not None


class OCRAPIKeyAuthentication(BaseAuthentication):
    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        try:
            if len(parts) != 2 or parts[0].lower() != b"bearer":
                raise ValueError
            token = parts[1].decode("ascii")
            prefix, secret = token.split(".", 1)
            if not prefix.startswith("ocr_") or len(secret) != 43:
                raise ValueError
            key_id = uuid.UUID(hex=prefix[4:])
            key = OCRAPIKey.objects.select_related("organization", "created_by").get(pk=key_id)
        except (ValueError, UnicodeError, OCRAPIKey.DoesNotExist):
            raise AuthenticationFailed("Invalid OCR API key.") from None
        digest = hashlib.sha256(secret.encode()).hexdigest()
        if (
            not hmac.compare_digest(digest, key.secret_hash)
            or key.revoked_at is not None
            or key.expires_at <= timezone.now()
            or not key.organization.is_active
            or not eligible_user(key.created_by)
            or not OrganizationMember.objects.filter(
                organization_id=key.organization_id, user_id=key.created_by_id,
                role__in=[OrganizationMember.Role.OWNER, OrganizationMember.Role.ADMIN],
            ).exists()
        ):
            raise AuthenticationFailed("Invalid OCR API key.")
        return key.created_by, key

    def authenticate_header(self, request):
        return "Bearer"


class OCRAPIKeyScheme(OpenApiAuthenticationExtension):
    target_class = "product.ocr.authentication.OCRAPIKeyAuthentication"
    name = "ocrApiKey"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "ocr_<key-id>.<secret>"}
