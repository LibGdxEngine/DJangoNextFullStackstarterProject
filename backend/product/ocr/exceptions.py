from rest_framework.exceptions import APIException


class OCRUnavailable(APIException):
    status_code = 503
    default_detail = "OCR service is not available."
    default_code = "ocr_unavailable"


class OCRConflict(APIException):
    status_code = 409
    default_detail = "The idempotency key was already used with a different request."
    default_code = "ocr_idempotency_conflict"


class OCRCapacityExceeded(APIException):
    status_code = 429
    default_detail = "The organization's OCR capacity or upload quota is exhausted."
    default_code = "ocr_capacity_exceeded"


class OCRResultUnavailable(APIException):
    status_code = 409
    default_detail = "The OCR result is not available."
    default_code = "ocr_result_unavailable"


class OCRResultExpired(APIException):
    status_code = 410
    default_detail = "The OCR result has expired."
    default_code = "ocr_result_expired"
