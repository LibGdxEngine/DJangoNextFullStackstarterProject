import re

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from django.core.files.uploadhandler import TemporaryFileUploadHandler
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import VersionedJWTAuthentication
from apps.organizations.models import OrganizationMember
from .authentication import OCRAPIKeyAuthentication, eligible_user
from .exceptions import OCRResultExpired, OCRResultUnavailable
from .models import OCRAPIKey, OCRJob, OCRUploadReservation
from .serializers import (OCRJobSerializer, OCRKeyCreatedSerializer, OCRKeyCreateSerializer,
                          OCRKeySerializer, OCRResultSerializer, OCRSubmitSerializer)
from .services import accept_upload, create_api_key, require_enabled, reserve_upload
from .uploads import LimitedOCRUploadHandler, UploadTooLarge, delete_upload, store_upload


ERROR_RESPONSE = {"$ref": "#/components/schemas/ApiErrorEnvelope"}


class OCRAPIView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class KeyView(OCRAPIView):
    authentication_classes = [VersionedJWTAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def memberships(self, request):
        if not eligible_user(request.user):
            raise PermissionDenied("An active verified account is required.")
        return OrganizationMember.objects.filter(
            user=request.user, organization__is_active=True,
            role__in=[OrganizationMember.Role.OWNER, OrganizationMember.Role.ADMIN],
        )

    @extend_schema(responses=OCRKeySerializer(many=True))
    def get(self, request):
        memberships = self.memberships(request)
        keys = OCRAPIKey.objects.filter(organization_id__in=memberships.values("organization_id")).order_by("-created_at")
        return Response(OCRKeySerializer(keys, many=True).data)

    @extend_schema(request=OCRKeyCreateSerializer, responses={201: OCRKeyCreatedSerializer})
    def post(self, request):
        require_enabled()
        serializer = OCRKeyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = self.memberships(request).select_related("organization").filter(
            organization_id=serializer.validated_data["organization_id"],
        ).first()
        if not membership:
            raise PermissionDenied("Organization administrator access is required.")
        key, token, secret = create_api_key(membership.organization, request.user, serializer.validated_data["name"])
        return Response({**OCRKeySerializer(key).data, "api_key": token, "webhook_signing_secret": secret}, status=201)


class KeyDetailView(KeyView):
    http_method_names = ["delete", "options"]

    @extend_schema(responses={204: None})
    def delete(self, request, key_id):
        keys = OCRAPIKey.objects.filter(pk=key_id, organization_id__in=self.memberships(request).values("organization_id"))
        if not keys.exists():
            raise Http404
        keys.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        return Response(status=204)


class OCRJobView(OCRAPIView):
    authentication_classes = [OCRAPIKeyAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    def initialize_request(self, request, *args, **kwargs):
        request.upload_handlers = [LimitedOCRUploadHandler(request), TemporaryFileUploadHandler(request)]
        return super().initialize_request(request, *args, **kwargs)

    @extend_schema(
        request=OCRSubmitSerializer, responses={202: OCRJobSerializer, 409: ERROR_RESPONSE, 413: ERROR_RESPONSE},
        parameters=[OpenApiParameter("Idempotency-Key", str, OpenApiParameter.HEADER, required=True)],
    )
    def post(self, request):
        require_enabled()
        idempotency_key = request.headers.get("Idempotency-Key", "")
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", idempotency_key):
            raise ValidationError({"Idempotency-Key": "Use 1 to 128 ASCII letters, digits, dots, underscores, colons or hyphens."})
        length = request.META.get("CONTENT_LENGTH", "")
        if length and int(length) > 151_000_000:
            raise UploadTooLarge()
        reservation = reserve_upload(request.auth.organization_id)
        metadata = None
        persisted = False
        try:
            data = request.data
            if set(data) != {"file", "webhook_url"} or any(len(data.getlist(field)) != 1 for field in data):
                raise ValidationError("Supply exactly one file and one webhook_url field.")
            serializer = OCRSubmitSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            metadata = store_upload(serializer.validated_data["file"])
            job, persisted = accept_upload(
                request.auth, reservation, idempotency_key, metadata, serializer.validated_data["webhook_url"],
            )
        finally:
            OCRUploadReservation.objects.filter(pk=reservation.pk).delete()
            if metadata and not persisted:
                delete_upload(metadata["storage_name"])
        from .tasks import dispatch_jobs
        # The database queue survives a broker outage; the periodic dispatcher retries.
        def dispatch_after_commit():
            try:
                dispatch_jobs.delay()
            except Exception:
                pass
        transaction.on_commit(dispatch_after_commit)
        return Response(OCRJobSerializer(job).data, status=202, headers={"Location": f"/api/v1/ocr/jobs/{job.id}/"})


class OCRJobDetailView(OCRAPIView):
    authentication_classes = [OCRAPIKeyAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_job(self, request, job_id):
        try:
            return OCRJob.objects.select_related("webhook_event").get(pk=job_id, organization_id=request.auth.organization_id)
        except OCRJob.DoesNotExist:
            raise Http404 from None

    @extend_schema(responses=OCRJobSerializer)
    def get(self, request, job_id):
        return Response(OCRJobSerializer(self.get_job(request, job_id)).data)


class OCRJobResultView(OCRJobDetailView):
    @extend_schema(responses={200: OCRResultSerializer, 409: ERROR_RESPONSE, 410: ERROR_RESPONSE})
    def get(self, request, job_id):
        job = self.get_job(request, job_id)
        if job.status == OCRJob.Status.EXPIRED or (job.result_expires_at and job.result_expires_at <= timezone.now()):
            raise OCRResultExpired()
        if job.status != OCRJob.Status.SUCCEEDED:
            raise OCRResultUnavailable()
        return Response({"id": str(job.id), "result": job.result})
