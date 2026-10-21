"""Phone OTP sign-in using the shared challenge, messaging and JWT services."""
import hashlib
import uuid
from datetime import timedelta
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, permissions
from rest_framework.exceptions import ValidationError, Throttled
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from apps.accounts.models import User, VerificationChallenge, VerificationPurpose
from apps.organizations.models import OrganizationMember
from django.db.models import Q
from apps.accounts.phone import normalize_phone, mask_phone
from apps.accounts.services.verification import create_verification_challenge, verify_challenge_code
from apps.accounts.services.authentication import issue_tokens_for_user
from apps.messaging.tasks import send_verification_message
from core.schema import AuthTokensSerializer


class LoginPhoneSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=30)

    def validate_phone(self, value):
        if not value.startswith("+"):
            raise serializers.ValidationError("Include the country code, for example +20.")
        try:
            return normalize_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))


class LoginCodeSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    code = serializers.RegexField(r"^[0-9]{6}$")


class LoginChallengeSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    destination = serializers.CharField()
    expires_in = serializers.IntegerField()
    resend_after = serializers.IntegerField()


class AcademyLoginThrottle(AnonRateThrottle):
    rate = "30/hour"
    scope = "academy_login"


class PhoneLoginRequestView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AcademyLoginThrottle]

    @extend_schema(tags=["academy-auth"], request=LoginPhoneSerializer, responses=LoginChallengeSerializer)
    def post(self, request):
        serializer = LoginPhoneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]
        key = "academy-login:" + hashlib.sha256(phone.encode()).hexdigest()
        if not cache.add(key, True, timeout=60):
            raise Throttled(wait=60)
        challenge_id = uuid.uuid4()
        with transaction.atomic():
            user = User.objects.select_for_update().filter(phone=phone, is_active=True).filter(Q(status="active", phone_verified_at__isnull=False) | Q(status="pending")).first()
            if user and user.status == "pending" and not OrganizationMember.objects.filter(user=user, organization__is_active=True).exists():
                user = None
            if user:
                recent = VerificationChallenge.objects.filter(user=user, purpose=VerificationPurpose.LOGIN, created_at__gte=timezone.now() - timedelta(hours=1)).count()
                if recent < 5:
                    VerificationChallenge.objects.filter(user=user, purpose=VerificationPurpose.LOGIN, consumed_at__isnull=True).update(consumed_at=timezone.now())
                    challenge, code = create_verification_challenge(user=user, purpose=VerificationPurpose.LOGIN, destination=phone)
                    challenge_id = challenge.id
                    transaction.on_commit(lambda: send_verification_message.delay(str(challenge.id), code))
        # Identical shape for unknown/inactive accounts; never expose account existence.
        return Response({"challenge_id": challenge_id, "destination": mask_phone(phone), "expires_in": 300, "resend_after": 60})


class PhoneLoginConfirmView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AcademyLoginThrottle]

    @extend_schema(tags=["academy-auth"], request=LoginCodeSerializer, responses=AuthTokensSerializer)
    def post(self, request):
        serializer = LoginCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        failure = False
        result = None
        with transaction.atomic():
            user_id = VerificationChallenge.objects.filter(pk=data["challenge_id"], purpose=VerificationPurpose.LOGIN).values_list("user_id", flat=True).first()
            if user_id:
                User.objects.select_for_update().get(pk=user_id)
            challenge = VerificationChallenge.objects.select_for_update().filter(pk=data["challenge_id"], purpose=VerificationPurpose.LOGIN).first()
            if not challenge:
                failure = True
            else:
                try:
                    verified = verify_challenge_code(str(challenge.id), data["code"], expected_purpose=VerificationPurpose.LOGIN)
                except DjangoValidationError:
                    failure = True
                else:
                    user = User.objects.select_for_update().get(pk=verified.user_id)
                    if user.status == "pending" and user.is_active and OrganizationMember.objects.filter(user=user, organization__is_active=True).exists():
                        user.status = "active"
                        user.phone_verified_at = timezone.now()
                        user.save(update_fields=["status", "phone_verified_at", "updated_at"])
                    if not user.is_active or user.status != "active" or not user.phone_verified_at:
                        failure = True
                    else:
                        result = issue_tokens_for_user(user)
        # Failed attempt counts must commit; raising inside atomic would reset them.
        if failure:
            raise ValidationError({"code": "Invalid, expired or exhausted verification code."})
        return Response(result)
