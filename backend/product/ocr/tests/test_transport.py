import io
import json
import socket
from unittest.mock import MagicMock, patch

import httpx
from django.test import SimpleTestCase, override_settings

from product.ocr.gpu import ModelError, run_model
from product.ocr.security import WebhookTransportError, deliver_webhook, validate_webhook_url


def address(ip):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443))]


class WebhookSecurityTests(SimpleTestCase):
    def test_rejects_unsafe_url_forms_without_network(self):
        with patch('product.ocr.security.socket.getaddrinfo') as resolver:
            for url in [
                'http://example.com/hook', 'https://user:pass@example.com/hook',
                'https://example.com:8443/hook', 'https://example.com/#fragment',
                'https://localhost/hook', 'https://127.0.0.1/hook',
                'https://[::1]/hook', 'https://2130706433/hook',
                'https://example.com\\@evil.com/hook', 'https://example.com/\r\nHost: evil',
            ]:
                with self.subTest(url=url), self.assertRaises(ValueError):
                    validate_webhook_url(url)
            resolver.assert_not_called()

    def test_rejects_private_special_and_mixed_dns_answers(self):
        for ip in ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.100.100.200', '0.0.0.0',
                   '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::']:
            with self.subTest(ip=ip), patch('product.ocr.security.socket.getaddrinfo', return_value=address('8.8.8.8') + address(ip)):
                with self.assertRaises(ValueError):
                    validate_webhook_url('https://example.com/hook')

    @patch('product.ocr.security.urllib3.HTTPSConnectionPool')
    @patch('product.ocr.security.socket.getaddrinfo', return_value=address('8.8.8.8'))
    def test_connection_is_pinned_with_original_tls_identity(self, resolver, pool_type):
        pool = pool_type.return_value
        pool.urlopen.return_value.status = 204
        status = deliver_webhook('https://hooks.example.com/path?q=1', b'{}', {'X-OCR-Signature': 'v1=test'})
        self.assertEqual(status, 204)
        resolver.assert_called_once()
        self.assertEqual(pool_type.call_args.args, ('8.8.8.8',))
        options = pool_type.call_args.kwargs
        self.assertEqual(options['server_hostname'], 'hooks.example.com')
        self.assertEqual(options['assert_hostname'], 'hooks.example.com')
        self.assertEqual(options['cert_reqs'], 'CERT_REQUIRED')
        request = pool.urlopen.call_args
        self.assertEqual(request.args, ('POST', '/path?q=1'))
        self.assertEqual(request.kwargs['headers']['Host'], 'hooks.example.com')
        self.assertFalse(request.kwargs['redirect'])
        self.assertFalse(request.kwargs['retries'])
        self.assertFalse(request.kwargs['preload_content'])
        pool.urlopen.return_value.close.assert_called_once()
        pool.close.assert_called_once()

    @patch('product.ocr.security.urllib3.HTTPSConnectionPool')
    def test_dns_rebinding_is_revalidated_before_delivery(self, pool_type):
        with patch('product.ocr.security.socket.getaddrinfo', side_effect=[address('8.8.8.8'), address('127.0.0.1')]):
            url = validate_webhook_url('https://example.com/hook')
            with self.assertRaises(WebhookTransportError):
                deliver_webhook(url, b'{}', {})
        pool_type.assert_not_called()


@override_settings(OCR_MODEL_URL='https://gpu.example.com/ocr',
                   OCR_MODEL_TIMEOUT=660, OCR_MODEL_FILE_FIELD='file', OCR_MAX_RESULT_BYTES=1000)
class ModelTransportTests(SimpleTestCase):
    def setUp(self):
        selector = patch('product.ocr.api_key_service.get_api_key', return_value='database-key')
        self.select_key = selector.start()
        self.addCleanup(selector.stop)

    def run_response(self, *, body=b'{"text":"hello"}', status=200, headers=None):
        source = io.BytesIO(b'%PDF-test')
        response = MagicMock()
        response.status_code = status
        response.headers = headers or {'content-type': 'application/json'}
        response.iter_raw.return_value = iter([body])
        with patch('product.ocr.gpu.private_path') as path, patch('product.ocr.gpu.httpx.Client') as client_type:
            path.return_value.open.return_value = source
            client = client_type.return_value.__enter__.return_value
            client.stream.return_value.__enter__.return_value = response
            result = run_model('private-id', 'application/pdf', 'job-id')
            return result, client_type.call_args, client.stream.call_args

    def test_streaming_upload_and_bounded_json_response(self):
        result, config, call = self.run_response()
        self.assertEqual(result, {'text': 'hello'})
        self.assertFalse(config.kwargs['trust_env'])
        self.assertFalse(config.kwargs['follow_redirects'])
        self.assertEqual(call.kwargs['headers']['Idempotency-Key'], 'job-id')
        self.assertEqual(call.kwargs['headers']['Authorization'], 'Bearer database-key')
        self.assertIsInstance(call.kwargs['files']['file'][1], io.BytesIO)

    @patch('product.ocr.api_key_service.get_api_key', side_effect=['provider-key-a', 'provider-key-b'])
    def test_each_model_request_consults_pool_and_uses_selected_key(self, select_key):
        _, _, first = self.run_response()
        _, _, second = self.run_response()
        self.assertEqual(first.kwargs['headers']['Authorization'], 'Bearer provider-key-a')
        self.assertEqual(second.kwargs['headers']['Authorization'], 'Bearer provider-key-b')
        self.assertEqual(select_key.call_count, 2)

    def test_empty_pool_fails_before_sending_a_document(self):
        from product.ocr.api_key_service import NoUsableApiKey
        with patch('product.ocr.api_key_service.get_api_key', side_effect=NoUsableApiKey('No available key')), patch('product.ocr.gpu.httpx.Client') as client:
            with self.assertRaises(ModelError) as caught:
                run_model('private-id', 'application/pdf', 'job-id')
            self.assertEqual(caught.exception.code, 'provider_keys_unavailable')
            client.assert_not_called()

    def test_rejects_invalid_large_or_compressed_results(self):
        for kwargs, code in [
            ({'body': b'x' * 1001}, 'model_result_too_large'),
            ({'body': b'<html>oops</html>'}, 'model_invalid_response'),
            ({'body': b'{"x":NaN}'}, 'model_invalid_response'),
            ({'body': b'null'}, 'model_invalid_response'),
            ({'status': 302}, 'model_response_error'),
            ({'headers': {'content-type': 'application/json', 'content-encoding': 'gzip'}}, 'model_invalid_response'),
        ]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ModelError) as caught:
                self.run_response(**kwargs)
            self.assertEqual(caught.exception.code, code)

    @override_settings(OCR_MODEL_URL='http://gpu.example.com/ocr')
    def test_model_url_is_server_configured_https(self):
        with self.assertRaises(ModelError) as caught:
            run_model('private-id', 'application/pdf', 'job-id')
        self.assertEqual(caught.exception.code, 'model_not_configured')

    def test_timeout_is_unknown_outcome_and_not_retried(self):
        with patch('product.ocr.gpu.private_path') as path, patch('product.ocr.gpu.httpx.Client') as client_type:
            path.return_value.open.return_value = io.BytesIO(b'%PDF')
            client = client_type.return_value.__enter__.return_value
            client.stream.side_effect = httpx.ReadTimeout('sensitive upstream details')
            with self.assertRaises(ModelError) as caught:
                run_model('private-id', 'application/pdf', 'job-id')
            self.assertEqual(str(caught.exception), 'model_outcome_unknown')
            self.assertEqual(client.stream.call_count, 1)
