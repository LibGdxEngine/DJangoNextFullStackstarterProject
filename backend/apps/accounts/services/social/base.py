from dataclasses import dataclass
from typing import Any, Dict

from django.conf import settings


class SocialAuthError(Exception):
    """
    Raised when a social identity cannot be verified or is not allowed to sign in.
    """


class ProviderNotConfiguredError(SocialAuthError):
    """
    Raised when a provider is unknown or its credentials are missing from the environment.
    """


@dataclass(frozen=True)
class SocialIdentity:
    """
    Normalized view of a verified external identity, independent of the provider.
    """
    provider: str
    provider_user_id: str
    email: str
    first_name: str = ""
    last_name: str = ""
    avatar_url: str = ""


def get_provider_config(provider: str) -> Dict[str, Any]:
    """
    Returns the provider settings, enforcing that it has been enabled via the environment.
    """
    config = settings.SOCIAL_AUTH_PROVIDERS.get(provider) or {}
    if not config.get("client_id"):
        raise ProviderNotConfiguredError(f"Social provider '{provider}' is not configured.")
    return config
