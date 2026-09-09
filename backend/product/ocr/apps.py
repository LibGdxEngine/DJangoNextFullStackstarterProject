from django.apps import AppConfig


class OCRConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "product.ocr"
    label = "ocr"

    def ready(self):
        from . import checks  # noqa: F401
