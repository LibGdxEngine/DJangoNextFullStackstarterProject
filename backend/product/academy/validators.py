from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator

currency_validator = RegexValidator(r"^[A-Z]{3}$", "Use a three-letter uppercase currency code.")


def validate_timezone(value):
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ValidationError("Use an IANA time zone, for example Africa/Cairo.")


def validate_weekdays(value):
    if not isinstance(value, list) or not value or any(type(day) is not int or day not in range(7) for day in value) or len(set(value)) != len(value):
        raise ValidationError("Choose unique weekdays from 0 (Monday) to 6 (Sunday).")
