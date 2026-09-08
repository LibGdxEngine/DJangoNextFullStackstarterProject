import uuid
from typing import Optional
from apps.accounts.models import User, VerificationChallenge
from apps.accounts.phone import normalize_phone


def get_user_by_id(user_id: str | uuid.UUID) -> Optional[User]:
    return User.objects.filter(id=user_id).first()


def get_user_by_email(email: str) -> Optional[User]:
    if not email:
        return None
    return User.objects.filter(email__iexact=email.strip()).first()


def get_user_by_phone(raw_phone: str) -> Optional[User]:
    if not raw_phone:
        return None
    try:
        phone = normalize_phone(raw_phone)
    except ValueError:
        return None
    return User.objects.filter(phone=phone).first()


def get_user_by_identifier(identifier: str) -> Optional[User]:
    if not identifier:
        return None
    identifier = identifier.strip()
    if "@" in identifier:
        return get_user_by_email(identifier)
    return get_user_by_phone(identifier)


def is_email_available(email: str, exclude_user_id: Optional[str | uuid.UUID] = None) -> bool:
    qs = User.objects.filter(email__iexact=email.strip())
    if exclude_user_id:
        qs = qs.exclude(id=exclude_user_id)
    return not qs.exists()


def is_phone_available(phone: str, exclude_user_id: Optional[str | uuid.UUID] = None) -> bool:
    qs = User.objects.filter(phone=phone)
    if exclude_user_id:
        qs = qs.exclude(id=exclude_user_id)
    return not qs.exists()


def get_challenge_by_id(challenge_id: str | uuid.UUID) -> Optional[VerificationChallenge]:
    try:
        return VerificationChallenge.objects.select_related("user").get(id=challenge_id)
    except (VerificationChallenge.DoesNotExist, ValueError):
        return None
