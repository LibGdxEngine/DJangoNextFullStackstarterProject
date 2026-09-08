import phonenumbers
from phonenumbers import NumberParseException


def normalize_phone(raw_phone: str, default_region: str = "EG") -> str:
    """
    Normalizes any phone string into canonical E.164 format (e.g. '+201039811349').
    Uses Google's phonenumbers library.

    Raises:
        ValueError: If phone cannot be parsed or is invalid.
    """
    if not raw_phone or not isinstance(raw_phone, str):
        raise ValueError("Phone number must be a non-empty string.")

    cleaned = raw_phone.strip()
    try:
        parsed = phonenumbers.parse(cleaned, default_region)
    except NumberParseException as exc:
        raise ValueError(f"Invalid phone number format: {exc}") from exc

    if not phonenumbers.is_valid_number(parsed):
        raise ValueError(f"'{raw_phone}' is not a valid phone number for region '{default_region}'.")

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def mask_phone(phone: str) -> str:
    """
    Masks a phone number for privacy display.
    Example: '+201039811349' -> '+2010******49'
    """
    if not phone or len(phone) < 6:
        return phone or ""

    # Keep leading country / prefix (first 5 chars) and trailing 2 chars
    prefix = phone[:5]
    suffix = phone[-2:]
    masked_part = "*" * (len(phone) - 7) if len(phone) > 7 else "****"
    return f"{prefix}{masked_part}{suffix}"
