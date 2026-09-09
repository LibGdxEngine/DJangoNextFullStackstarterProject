"""Explicit contracts for APIViews and shared errors not inferred by DRF."""
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.utils import (
    OpenApiParameter, PolymorphicProxySerializer, extend_schema,
    extend_schema_view,
)
from rest_framework import serializers

from apps.accounts.api import serializers as accounts
from apps.accounts.api import views as auth
from apps.accounts.models import UserStatus, VerificationPurpose


class ContractAutoSchema(AutoSchema):
    def _get_request_body(self, direction='request'):
        # Spectacular normally omits DELETE bodies. Account deletion requires
        # password confirmation, unlike the platform's ordinary resource deletes.
        if self.method == 'DELETE' and isinstance(self.view, auth.UserProfileView):
            schema, required = self._get_request_for_media_type(
                self.get_request_serializer(), direction,
            )
            return {
                'content': {media: {'schema': schema} for media in self.map_parsers()},
                'required': required,
            }
        return super()._get_request_body(direction)


class TokenUserSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    phone = serializers.CharField(allow_null=True, allow_blank=True)
    status = serializers.ChoiceField(choices=UserStatus.choices)
    first_name = serializers.CharField(allow_blank=True)
    last_name = serializers.CharField(allow_blank=True)


class TokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()


class AuthTokensSerializer(TokenPairSerializer):
    user = TokenUserSerializer()


class SocialAuthResponseSerializer(AuthTokensSerializer):
    created = serializers.BooleanField()
    requires_phone = serializers.BooleanField()


class MessageResponseSerializer(serializers.Serializer):
    message = serializers.CharField()


class SignupVerificationSerializer(AuthTokensSerializer):
    message = serializers.CharField()


class PurposeVerificationSerializer(MessageResponseSerializer):
    purpose = serializers.ChoiceField(choices=VerificationPurpose.choices)


class VerificationResentSerializer(MessageResponseSerializer):
    expires_in = serializers.IntegerField()


class PasswordForgotResponseSerializer(MessageResponseSerializer):
    challenge_id = serializers.UUIDField(required=False)


class PasswordResetVerifiedSerializer(MessageResponseSerializer):
    reset_token = serializers.CharField()


class AccountDeletionChallengeSerializer(MessageResponseSerializer):
    verification_required = serializers.BooleanField()
    challenge_id = serializers.UUIDField()
    destination = serializers.CharField()


class SocialProvidersSerializer(serializers.Serializer):
    providers = serializers.ListField(child=serializers.CharField())


class HelloResponseSerializer(MessageResponseSerializer):
    status = serializers.CharField()


class BeatStatusSerializer(serializers.Serializer):
    status = serializers.CharField()
    last_seen = serializers.DateTimeField(allow_null=True)


class SystemStatusSerializer(serializers.Serializer):
    database = serializers.CharField()
    redis = serializers.CharField()
    celery = serializers.CharField()
    beat = BeatStatusSerializer()


class WebhookReceivedSerializer(serializers.Serializer):
    status = serializers.CharField()
    event_id = serializers.UUIDField()


def annotate_views():
    """Attach schema metadata without changing view execution or response data."""
    from apps.common.views import hello_world, system_status
    from apps.integrations.hireagents.webhooks import hireagents_webhook_view
    from apps.notifications.views import NotificationMarkReadView
    from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView
    from rest_framework_simplejwt.serializers import TokenRefreshSerializer, TokenVerifySerializer

    post_contracts = [
        (auth.SignupView, accounts.SignupSerializer, accounts.VerificationChallengeResponseSerializer, 201),
        (auth.LoginView, accounts.LoginSerializer, AuthTokensSerializer, 200),
        (auth.LogoutView, accounts.LogoutSerializer, MessageResponseSerializer, 200),
        (auth.PasswordForgotView, accounts.PasswordForgotSerializer, PasswordForgotResponseSerializer, 200),
        (auth.PasswordResetVerifyView, accounts.PasswordResetVerifySerializer, PasswordResetVerifiedSerializer, 200),
        (auth.PasswordResetConfirmView, accounts.PasswordResetConfirmSerializer, MessageResponseSerializer, 200),
        (auth.PasswordChangeView, accounts.PasswordChangeSerializer, MessageResponseSerializer, 200),
        (auth.VerificationResendView, accounts.VerificationResendSerializer, VerificationResentSerializer, 200),
        (auth.PhoneChangeInitiateView, accounts.PhoneChangeInitiateSerializer, accounts.VerificationChallengeResponseSerializer, 200),
        (auth.PhoneChangeConfirmView, accounts.PhoneChangeConfirmSerializer, MessageResponseSerializer, 200),
        (auth.EmailChangeView, accounts.EmailChangeSerializer, MessageResponseSerializer, 200),
        (auth.SocialAuthView, accounts.SocialAuthSerializer, SocialAuthResponseSerializer, 200),
        (TokenObtainPairView, accounts.LoginSerializer, TokenPairSerializer, 200),
        (TokenRefreshView, TokenRefreshSerializer, TokenPairSerializer, 200),
        (TokenVerifyView, TokenVerifySerializer, {'type': 'object', 'additionalProperties': False}, 200),
    ]
    for view, request, response, status in post_contracts:
        extend_schema_view(post=extend_schema(request=request, responses={status: response}))(view)

    extend_schema_view(post=extend_schema(
        request=accounts.VerificationConfirmSerializer,
        responses=PolymorphicProxySerializer(
            component_name='VerificationConfirmed',
            serializers=[SignupVerificationSerializer, PurposeVerificationSerializer],
            resource_type_field_name=None,
        ),
    ))(auth.VerificationConfirmView)
    extend_schema_view(get=extend_schema(responses=SocialProvidersSerializer))(auth.SocialProvidersView)
    extend_schema_view(
        get=extend_schema(responses=accounts.UserProfileSerializer),
        patch=extend_schema(request=accounts.UserProfileSerializer, responses=accounts.UserProfileSerializer),
        delete=extend_schema(request=accounts.AccountDeletionInitiateSerializer, responses={200: AccountDeletionChallengeSerializer}),
    )(auth.UserProfileView)
    extend_schema_view(patch=extend_schema(request=None))(NotificationMarkReadView)
    extend_schema(responses=HelloResponseSerializer)(hello_world)
    extend_schema(responses=SystemStatusSerializer)(system_status)
    extend_schema(
        request={'application/json': {'anyOf': [{'type': 'object', 'additionalProperties': True}, {'type': 'array', 'items': {}}, {'type': 'string'}, {'type': 'number'}, {'type': 'boolean'}], 'nullable': True, 'description': 'Provider event JSON; unknown keys are preserved. Non-object JSON is accepted as an empty payload.'}},
        responses=WebhookReceivedSerializer,
        parameters=[
            OpenApiParameter('X-Api-Key', str, OpenApiParameter.HEADER, description='Required when this connection has a webhook API key.'),
            OpenApiParameter('X-HireAgents-Signature', str, OpenApiParameter.HEADER, description='HMAC-SHA256 of the raw body; required when a signing secret is configured.'),
        ],
    )(hireagents_webhook_view)


def add_error_responses(result, generator, request, public):
    """Document the common envelope, including failures handled outside DRF."""
    result['components']['schemas']['ApiErrorEnvelope'] = {
        'type': 'object', 'required': ['error'], 'properties': {
            'error': {
                'type': 'object', 'required': ['code', 'message', 'fields'],
                'properties': {
                    'code': {'type': 'string'},
                    'message': {'type': 'string'},
                    'fields': {'type': 'object', 'additionalProperties': {
                        'type': 'array', 'items': {'type': 'string'},
                    }},
                    'context': {'type': 'object', 'additionalProperties': True},
                },
            },
        },
    }
    # These infrastructure probes are ordinary Django views, so DRF's endpoint
    # discovery cannot inspect them. Document their public API routes explicitly.
    for name, properties in {
        'HealthLiveness': {'status': {'type': 'string'}},
        'HealthReadiness': {'database': {'type': 'string'}, 'redis': {'type': 'string'}},
    }.items():
        result['components']['schemas'][name] = {
            'type': 'object', 'properties': properties, 'required': list(properties),
        }
    for path, name, operation_id in (
        ('/api/health/live/', 'HealthLiveness', 'health_live_retrieve'),
        ('/api/health/ready/', 'HealthReadiness', 'health_ready_retrieve'),
    ):
        result['paths'][path] = {'get': {
            'operationId': operation_id,
            'tags': ['health'],
            'responses': {'200': {
                'description': 'Current infrastructure health.',
                'content': {'application/json': {'schema': {
                    '$ref': f'#/components/schemas/{name}',
                }}},
            }},
        }}
    descriptions = {
        '400': 'Invalid request or validation error.',
        '401': 'Authentication failed or session expired.',
        '403': 'Permission denied or required verification.',
        '404': 'Resource not found.', '405': 'Method not allowed.',
        '406': 'Response format not acceptable.', '415': 'Unsupported media type.',
        '429': 'Request throttled.', '500': 'Unexpected internal error.',
        '503': 'A required service is unavailable.',
    }
    for path in result['paths'].values():
        for method, operation in path.items():
            if method not in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'):
                continue
            for status, description in descriptions.items():
                operation['responses'][status] = {
                    'description': description,
                    'content': {'application/json': {'schema': {
                        '$ref': '#/components/schemas/ApiErrorEnvelope',
                    }}},
                }
    return result
