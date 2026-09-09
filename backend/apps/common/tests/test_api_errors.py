from unittest.mock import patch

from django.core.exceptions import PermissionDenied, SuspiciousOperation, ValidationError as DjangoValidationError
from django.http import Http404, HttpResponse, JsonResponse
from django.test import SimpleTestCase, override_settings
from django.urls import path
from rest_framework import exceptions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIClient

from core.api_errors import exception_handler, flatten_errors, normalize_error, validation_error_response


@api_view(["POST"])
def validation_view(request):
    if request.data.get("nested"):
        raise exceptions.ValidationError({"members": [{"email": ["Invalid email."]}, {}]})
    raise exceptions.ValidationError({"name": ["This field is required."]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def protected_view(request):
    return Response({"ok": True})


@api_view(["GET"])
def forbidden_view(request):
    raise exceptions.PermissionDenied("Membership is required.")


@api_view(["GET"])
def throttled_view(request):
    raise exceptions.Throttled(wait=12)


@api_view(["GET"])
def success_view(request):
    return Response({"message": "unchanged"})


def django_error_view(request, kind):
    if kind == "bad":
        raise SuspiciousOperation("private bad request details")
    if kind == "forbidden":
        raise PermissionDenied("private permission details")
    if kind == "missing":
        raise Http404("private missing resource details")
    raise RuntimeError("private exception details")


def headers_view(request):
    response = JsonResponse({"detail": "Please authenticate."}, status=401)
    response["WWW-Authenticate"] = 'Bearer realm="api"'
    response["Retry-After"] = "12"
    response["X-Custom"] = "retained"
    response.set_cookie("example", "retained", httponly=True)
    return response


urlpatterns = [
    path("api/validation/", validation_view),
    path("api/protected/", protected_view),
    path("api/throttled/", throttled_view),
    path("api/forbidden/", forbidden_view),
    path("api/success/", success_view),
    path("api/headers/", headers_view),
    path("api/django/<str:kind>/", django_error_view),
    path("page/<str:kind>/", django_error_view),
    path("api/docs/", lambda request: HttpResponse("<html>Docs</html>")),
]


@override_settings(ROOT_URLCONF=__name__)
class ApiErrorContractTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient(raise_request_exception=False)

    def test_validation_fields_and_nested_paths(self):
        response = self.client.post("/api/validation/", {"nested": True}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], {
            "code": "validation_error",
            "message": "Please correct the highlighted fields.",
            "fields": {"members.0.email": ["Invalid email."]},
        })
        self.assertEqual(flatten_errors(["Invalid object."]), {"non_field_errors": ["Invalid object."]})
        self.assertEqual(flatten_errors({"roles": ["Unknown.", "Invalid."]}), {"roles": ["Unknown.", "Invalid."]})

    def test_invalid_envelope_is_normalized(self):
        body = normalize_error({"error": {"unexpected": ["Invalid."]}}, 400)
        self.assertEqual(body["error"]["code"], "bad_request")
        self.assertEqual(body["error"]["fields"], {"unexpected": ["Invalid."]})

    def test_django_validation_fields(self):
        response = validation_error_response(DjangoValidationError({"email": ["Already in use."]}))
        self.assertEqual(response.data["error"]["fields"], {"email": ["Already in use."]})
        response = validation_error_response(DjangoValidationError({"__all__": ["Invalid object."]}))
        self.assertEqual(response.data["error"]["fields"], {"non_field_errors": ["Invalid object."]})

    def test_authentication_header_preserved(self):
        response = self.client.get("/api/protected/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "not_authenticated")
        self.assertIn("Bearer", response["WWW-Authenticate"])

    def test_permission_error_is_normalized(self):
        response = self.client.get("/api/forbidden/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")
        self.assertEqual(response.json()["error"]["message"], "Membership is required.")

    @override_settings(ROOT_URLCONF="core.urls")
    def test_legacy_token_endpoints_use_envelope(self):
        for endpoint in ("/api/token/", "/api/token/refresh/", "/api/token/verify/"):
            with self.subTest(endpoint=endpoint):
                response = self.client.post(endpoint, {}, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "validation_error")
                self.assertTrue(response.json()["error"]["fields"])

    def test_invalid_token_uses_envelope(self):
        response = self.client.get("/api/protected/", HTTP_AUTHORIZATION="Bearer invalid")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "token_not_valid")

    def test_malformed_json(self):
        response = self.client.post("/api/validation/", "{broken", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "parse_error")

    def test_method_not_allowed(self):
        response = self.client.delete("/api/success/")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.json()["error"]["code"], "method_not_allowed")
        self.assertIn("GET", response["Allow"])

    def test_throttling_header_preserved(self):
        response = self.client.get("/api/throttled/")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "throttled")
        self.assertEqual(response["Retry-After"], "12")

    def test_headers_and_cookies_preserved(self):
        response = self.client.get("/api/headers/")
        self.assertEqual(response.json()["error"]["message"], "Please authenticate.")
        self.assertEqual(response["WWW-Authenticate"], 'Bearer realm="api"')
        self.assertEqual(response["Retry-After"], "12")
        self.assertEqual(response["X-Custom"], "retained")
        self.assertEqual(response.cookies["example"].value, "retained")
        self.assertTrue(response.cookies["example"]["httponly"])

    def test_django_failures_are_safe_in_both_debug_modes(self):
        for debug in (True, False):
            for kind, status_code, code in (
                ("bad", 400, "bad_request"),
                ("forbidden", 403, "permission_denied"),
                ("missing", 404, "not_found"),
                ("crash", 500, "internal_error"),
            ):
                with self.subTest(debug=debug, kind=kind), override_settings(DEBUG=debug):
                    response = self.client.get(f"/api/django/{kind}/")
                    self.assertEqual(response.status_code, status_code)
                    self.assertEqual(response.json()["error"]["code"], code)
                    self.assertNotIn("private", response.content.decode())
            with override_settings(DEBUG=debug):
                response = self.client.get("/api/unmatched/")
                self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_unexpected_exception_is_logged_by_django(self):
        with self.assertLogs("django.request", level="ERROR") as captured:
            response = self.client.get("/api/django/crash/")
        self.assertEqual(response.status_code, 500)
        self.assertTrue(any(record.exc_info and record.exc_info[0] is RuntimeError for record in captured.records))

    def test_success_and_non_api_responses_are_unchanged(self):
        self.assertEqual(self.client.get("/api/success/").json(), {"message": "unchanged"})
        self.assertEqual(self.client.get("/api/docs/").content, b"<html>Docs</html>")
        response = self.client.get("/page/missing/")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(response["Content-Type"].startswith("text/html"))

    def test_drf_handler_preserves_rollback_and_unknown_exception_propagation(self):
        with patch("rest_framework.views.set_rollback") as rollback:
            response = exception_handler(exceptions.ValidationError(["Invalid."]), {})
        rollback.assert_called_once_with()
        self.assertEqual(response.data["error"]["fields"], {"non_field_errors": ["Invalid."]})
        self.assertIsNone(exception_handler(RuntimeError("private"), {}))
