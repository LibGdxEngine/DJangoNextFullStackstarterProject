"""Regression checks for contracts that DRF cannot infer automatically."""
from django.test import SimpleTestCase
from drf_spectacular.generators import SchemaGenerator
from drf_spectacular.validation import validate_schema


class ApiSchemaTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.schema = SchemaGenerator().get_schema(request=None, public=True)

    def test_schema_validates_without_database_queries(self):
        validate_schema(self.schema)

    def test_auth_aliases_expose_matching_contracts(self):
        for path, operations in self.schema['paths'].items():
            if not path.startswith('/api/accounts/'):
                continue
            alias = path.replace('/api/accounts/', '/api/v1/auth/', 1)
            for method, operation in operations.items():
                alias_operation = self.schema['paths'][alias][method]
                self.assertEqual(operation['responses'], alias_operation['responses'])
                self.assertEqual(operation.get('requestBody'), alias_operation.get('requestBody'))

    def test_deletion_requires_password_and_returns_challenge(self):
        operation = self.schema['paths']['/api/v1/auth/me/']['delete']
        self.assertTrue(operation['requestBody']['required'])
        request_ref = operation['requestBody']['content']['application/json']['schema']['$ref']
        request_schema = self.schema['components']['schemas'][request_ref.rsplit('/', 1)[1]]
        self.assertEqual(request_schema['required'], ['password'])
        self.assertIn('200', operation['responses'])
        self.assertNotIn('204', operation['responses'])

    def test_notification_patch_has_no_input_but_put_requires_content(self):
        operations = self.schema['paths']['/api/notifications/{id}/read/']
        self.assertNotIn('requestBody', operations['patch'])
        self.assertTrue(operations['put']['requestBody']['required'])

    def test_token_summary_and_profile_are_distinct(self):
        schemas = self.schema['components']['schemas']
        self.assertNotIn('created_at', schemas['TokenUser']['properties'])
        self.assertIn('created_at', schemas['UserProfile']['properties'])
        self.assertTrue(schemas['TokenUser']['properties']['phone']['nullable'])
        self.assertIn('requires_phone', schemas['SocialAuthResponse']['required'])
        self.assertNotIn('password', schemas['AuthTokens']['properties'])

    def test_verification_describes_both_runtime_shapes(self):
        schemas = self.schema['components']['schemas']
        self.assertEqual(len(schemas['VerificationConfirmed']['oneOf']), 2)

    def test_read_only_diagnostics_match_current_health_shapes(self):
        schemas = self.schema['components']['schemas']
        self.assertEqual(schemas['SystemStatus']['properties']['celery']['type'], 'string')
        self.assertEqual(schemas['SystemStatus']['properties']['beat']['$ref'], '#/components/schemas/BeatStatus')
        self.assertTrue(schemas['BeatStatus']['properties']['last_seen']['nullable'])
        for path in ('/api/status/', '/api/common/status/', '/api/health/ready/'):
            self.assertIn('503', self.schema['paths'][path]['get']['responses'])
        for path in ('/api/health/live/', '/api/health/ready/'):
            self.assertIn('200', self.schema['paths'][path]['get']['responses'])

    def test_all_operations_document_the_common_error_envelope(self):
        for path, operations in self.schema['paths'].items():
            for method, operation in operations.items():
                with self.subTest(path=path, method=method):
                    for status in ('400', '401', '403', '404', '405', '429', '500', '503'):
                        response = operation['responses'][status]['content']['application/json']
                        self.assertEqual(response['schema'], {
                            '$ref': '#/components/schemas/ApiErrorEnvelope',
                        })
