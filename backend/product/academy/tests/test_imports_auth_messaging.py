import io
import uuid
import zipfile
from datetime import timedelta
from unittest.mock import patch
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from apps.accounts.models import VerificationChallenge
from apps.accounts.services.verification import compute_code_digest
from product.academy import models as m
from product.academy.services.imports import read_upload, safe_csv
from product.academy.services.messaging import queue_due_reminders, dispatch_message
from .test_workflows import AcademyFixture


class ImportTests(AcademyFixture):
    def upload(self, text):
        file = SimpleUploadedFile("families.csv", text.encode("utf-8"), content_type="text/csv")
        response = self.client.post(self.base + "imports/upload/", {"file": file}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def test_csv_import_links_siblings_and_is_idempotent(self):
        headers = "family_external_id,family_name,contact_name,phone,student_external_id,student_name"
        job_id = self.upload(headers + "\nfamily-1,New Family,Parent,+201055556666,s1,Child One\nfamily-1,New Family,Parent,+201055556666,s2,Child Two")
        mapping = {name: name for name in headers.split(",")}
        validation = self.post(f"imports/{job_id}/validate/", {"mapping": mapping})
        self.assertEqual(validation.data["data"]["valid_rows"], 2)
        self.confirm(f"imports/{job_id}/execute/", {})
        self.post(f"imports/{job_id}/execute/", {})
        self.assertEqual(m.Student.objects.filter(external_id__in=["s1", "s2"]).count(), 2)
        self.assertEqual(m.Family.objects.filter(external_id="family-1").count(), 1)
        family = m.Family.objects.get(external_id="family-1")
        job2 = self.upload(headers + "\nfamily-1,New Family,Parent,+201055556666,s3,Child Three")
        self.post(f"imports/{job2}/validate/", {"mapping": mapping})
        self.confirm(f"imports/{job2}/execute/", {})
        self.assertEqual(family.students.count(), 3)

    def test_invalid_import_is_not_partially_applied(self):
        headers = "family_external_id,family_name,contact_name,phone,student_external_id,student_name"
        job = self.upload(headers + "\nf1,Family,Parent,invalid,s1,Child\nf1,Family,Parent,+201055556666,s2,Second")
        result = self.post(f"imports/{job}/validate/", {"mapping": {name: name for name in headers.split(",")}})
        self.assertEqual(len(result.data["data"]["errors"]), 1)
        self.post(f"imports/{job}/execute/", {}, 400)
        self.assertFalse(m.Student.objects.filter(external_id="s2").exists())
        self.assertEqual(self.client.get(self.base + f"imports/{job}/error-report/").status_code, 200)

    def test_import_revalidates_against_changes_after_preview(self):
        headers = "family_external_id,family_name,contact_name,phone,student_external_id,student_name"
        job = self.upload(headers + "\nf1,Family,Parent,+201055556666,s1,Child")
        self.post(f"imports/{job}/validate/", {"mapping": {name: name for name in headers.split(",")}})
        preview = self.post(f"imports/{job}/execute/", {})
        m.Student.objects.create(organization=self.org, family=self.family, name="Existing", external_id="s1")
        self.post(f"imports/{job}/execute/", {"preview_token": preview.data["preview_token"]}, 400)
        self.assertEqual(m.Student.objects.filter(external_id="s1").count(), 1)

    def test_xlsx_first_sheet_and_formula_rejection(self):
        def workbook(formula=False):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="People" sheetId="2" r:id="rId1"/></sheets></workbook>')
                archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>')
                archive.writestr("xl/worksheets/sheet2.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row><c r="A2" t="inlineStr">' + ('<f>1+1</f>' if formula else '') + '<is><t>أحمد</t></is></c></row></sheetData></worksheet>')
            return SimpleUploadedFile("test.xlsx", stream.getvalue())
        columns, rows = read_upload(workbook())
        self.assertEqual(columns, ["Name"])
        self.assertEqual(rows, [{"Name": "أحمد"}])
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            read_upload(workbook(True))

    def test_csv_exports_neutralize_formulas(self):
        self.assertIn("'=SUM", safe_csv([["=SUM(A1)"]]))


class ReceiptAndApprovalTests(AcademyFixture):
    def payment(self, reference=""):
        return self.post("payments/", {"enrollment": str(self.enrollment.id), "amount": "40.00", "currency": "USD", "reference": reference}, 201).data["id"]

    def test_receipt_is_private_and_duplicate_requires_acknowledgement(self):
        first, second = self.payment("reference"), self.payment("reference")
        for pk in [first, second]:
            upload = SimpleUploadedFile("receipt.pdf", b"%PDF-1.4 receipt", content_type="application/pdf")
            response = self.client.post(self.base + f"payments/{pk}/upload-receipt/", {"file": upload}, format="multipart")
            self.assertEqual(response.status_code, 200, response.data)
        data = {"decision": "approved", "reason": "Verified"}
        preview = self.post(f"payments/{first}/review/", data)
        self.assertEqual(preview.data["data"]["duplicate_ids"], [str(second)])
        self.post(f"payments/{first}/review/", {**data, "preview_token": preview.data["preview_token"]}, 400)
        self.post(f"payments/{first}/review/", {**data, "preview_token": preview.data["preview_token"], "acknowledge_duplicates": True})
        response = self.client.get(self.base + f"payments/{first}/receipt/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.client.force_authenticate(self.teacher_user)
        self.assertEqual(self.client.get(self.base + f"payments/{first}/receipt/").status_code, 403)

    def test_payment_currency_must_match_purchase(self):
        self.post("payments/", {"enrollment": str(self.enrollment.id), "amount": "40.00", "currency": "EUR"}, 400)

    def test_repeated_payment_approval_does_not_reactivate_package(self):
        pk = self.payment()
        self.confirm(f"payments/{pk}/review/", {"decision": "approved", "reason": "Verified"})
        self.post(f"payments/{pk}/review/", {"decision": "approved", "reason": "Retry"}, 400)
        self.assertEqual(self.enrollment.ledger.filter(key__startswith="activation:").count(), 1)


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class PhoneLoginTests(AcademyFixture):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client.force_authenticate(None)
        self.auth_base = "/api/product/academy/auth/"

    @patch("product.academy.auth.send_verification_message.delay")
    def challenge(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.auth_base + "request-code/", {"phone": self.owner.phone}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(send.call_count, 1)
        challenge = VerificationChallenge.objects.get(pk=response.data["challenge_id"])
        challenge.code_digest = compute_code_digest("123456")
        challenge.save()
        return challenge

    def test_phone_code_issues_tokens_and_is_single_use(self):
        challenge = self.challenge()
        payload = {"challenge_id": str(challenge.id), "code": "123456"}
        response = self.client.post(self.auth_base + "confirm-code/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        self.assertEqual(self.client.post(self.auth_base + "confirm-code/", payload, format="json").status_code, 400)

    def test_wrong_code_attempts_persist_and_exhaust(self):
        challenge = self.challenge()
        for _ in range(5):
            response = self.client.post(self.auth_base + "confirm-code/", {"challenge_id": str(challenge.id), "code": "000000"}, format="json")
            self.assertEqual(response.status_code, 400)
        challenge.refresh_from_db()
        self.assertEqual(challenge.attempt_count, 5)
        response = self.client.post(self.auth_base + "confirm-code/", {"challenge_id": str(challenge.id), "code": "123456"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_request_cooldown_and_unknown_phone_response(self):
        response = self.client.post(self.auth_base + "request-code/", {"phone": "+201099998888"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["resend_after"], 60)
        self.assertEqual(self.client.post(self.auth_base + "request-code/", {"phone": "+201099998888"}, format="json").status_code, 429)


class MessagingTests(AcademyFixture):
    def setUp(self):
        super().setUp()
        template = m.MessageTemplate.objects.create(organization=self.org, name="reminder", provider_template="class_reminder", language="ar", body="Class reminder")
        m.MessageAutomation.objects.create(organization=self.org, event="reminder", template=template, is_enabled=True)
        self.session = self.make_session(days=0)
        self.session.starts_at = timezone.now() + timedelta(minutes=30)
        self.session.ends_at = self.session.starts_at + timedelta(minutes=30)
        self.session.save()

    def test_reminder_queue_is_deduplicated_and_missing_connection_visible(self):
        queue_due_reminders()
        queue_due_reminders()
        self.assertEqual(m.Message.objects.count(), 1)
        message = m.Message.objects.get()
        dispatch_message(message.id)
        message.refresh_from_db()
        self.assertEqual(message.status, "action_required")
        self.settings.refresh_from_db()
        self.assertEqual(self.settings.whatsapp_status, "action_required")

    @override_settings(ACADEMY_WHATSAPP_CONNECTIONS={"test-academy": "academy-test"}, HIREAGENTS_CONNECTIONS={"academy-test": {"channel_id": "mock-channel", "api_key": "mock-key"}})
    @patch("apps.messaging.services.get_whatsapp_provider")
    def test_delivery_is_mocked_and_sent_once(self, provider):
        provider.return_value.send_template.return_value = {"id": "provider-1"}
        queue_due_reminders()
        message = m.Message.objects.get()
        dispatch_message(message.id)
        dispatch_message(message.id)
        self.assertEqual(provider.return_value.send_template.call_count, 1)
        message.refresh_from_db()
        self.assertEqual(message.status, "sent")
        self.assertEqual(message.provider_message_id, "provider-1")

    @override_settings(ACADEMY_WHATSAPP_CONNECTIONS={"test-academy": "academy-test"}, HIREAGENTS_CONNECTIONS={"academy-test": {"channel_id": "mock-channel", "api_key": "mock-key"}})
    @patch("apps.messaging.services.get_whatsapp_provider")
    def test_uncertain_delivery_is_not_retried_automatically(self, provider):
        provider.return_value.send_template.side_effect = TimeoutError("Provider timeout")
        queue_due_reminders()
        message = m.Message.objects.get()
        dispatch_message(message.id)
        dispatch_message(message.id)
        self.assertEqual(provider.return_value.send_template.call_count, 1)
        message.refresh_from_db()
        self.assertEqual(message.status, "action_required")


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class ProvisioningTests(AcademyFixture):
    @patch("product.academy.auth.send_verification_message.delay")
    def test_invited_family_account_activates_only_after_otp(self, send):
        cache.clear()
        response = self.post("members/", {"email": "invited@academy.test", "phone": "+201066667777", "first_name": "Invited"}, 201)
        user_id = response.data["user"]
        self.assertEqual(response.data["account_status"], "pending")
        self.assertFalse(send.called)
        contact = self.post("family-contacts/", {"family": str(self.family.id), "user": str(user_id), "name": "Invited", "phone": "+201066667777", "relationship": "parent"}, 201)
        self.client.force_authenticate(None)
        with self.captureOnCommitCallbacks(execute=True):
            challenge_response = self.client.post("/api/product/academy/auth/request-code/", {"phone": "+201066667777"}, format="json")
        self.assertEqual(challenge_response.status_code, 200)
        challenge = VerificationChallenge.objects.get(pk=challenge_response.data["challenge_id"])
        challenge.code_digest = compute_code_digest("123456")
        challenge.save()
        verified = self.client.post("/api/product/academy/auth/confirm-code/", {"challenge_id": str(challenge.id), "code": "123456"}, format="json")
        self.assertEqual(verified.status_code, 200, verified.data)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + verified.data["access"])
        workspaces = self.client.get("/api/product/academy/workspaces/")
        self.assertEqual(workspaces.status_code, 200)
        self.assertEqual(workspaces.data[0]["workspaces"], ["family"])
