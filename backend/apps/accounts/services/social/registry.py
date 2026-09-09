from typing import Callable, Dict, List

from django.conf import settings

from .base import ProviderNotConfiguredError, SocialIdentity, get_provider_config
from .google import PROVIDER as GOOGLE, verify_google_id_token

# Registering a new provider is a single entry here plus its verifier module.
PROVIDER_VERIFIERS: Dict[str, Callable[[str], SocialIdentity]] = {
    GOOGLE: verify_google_id_token,
}


def get_verifier(provider: str) -> Callable[[str], SocialIdentity]:
    verifier = PROVIDER_VERIFIERS.get(provider)
    if verifier is None:
        raise ProviderNotConfiguredError(f"Unknown social provider '{provider}'.")
    get_provider_config(provider)
    return verifier


def get_enabled_providers() -> List[str]:
    return [
        provider
        for provider in PROVIDER_VERIFIERS
        if (settings.SOCIAL_AUTH_PROVIDERS.get(provider) or {}).get("client_id")
    ]
