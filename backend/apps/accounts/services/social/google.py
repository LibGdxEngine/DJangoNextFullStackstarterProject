from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_transport
from google.oauth2 import id_token as google_id_token

from .base import SocialAuthError, SocialIdentity, get_provider_config

PROVIDER = "google"
NAME_MAX_LENGTH = 150

# Reused across calls so the underlying HTTP session pools connections to Google.
_transport = google_transport.Request()


def verify_google_id_token(token: str) -> SocialIdentity:
    """
    Verifies a Google ID token signature, audience and expiry against Google's public keys.
    Claims are only trusted after this call succeeds.
    """
    client_id = get_provider_config(PROVIDER)["client_id"]

    try:
        claims = google_id_token.verify_oauth2_token(token, _transport, audience=client_id)
    except (GoogleAuthError, ValueError) as exc:
        raise SocialAuthError("Google sign-in token is invalid or has expired.") from exc

    if not claims.get("email_verified"):
        raise SocialAuthError("This Google account does not have a verified email address.")

    email = (claims.get("email") or "").strip()
    if not email:
        raise SocialAuthError("Google sign-in did not return an email address.")

    return SocialIdentity(
        provider=PROVIDER,
        provider_user_id=claims["sub"],
        email=email,
        first_name=(claims.get("given_name") or "")[:NAME_MAX_LENGTH],
        last_name=(claims.get("family_name") or "")[:NAME_MAX_LENGTH],
        avatar_url=claims.get("picture") or "",
    )
