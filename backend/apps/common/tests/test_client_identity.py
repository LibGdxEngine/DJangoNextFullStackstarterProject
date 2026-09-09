from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory

from apps.common.client_identity import get_client_ip
from apps.common.rate_limits import RateLimitUnavailable


@override_settings(RATE_LIMIT_TRUST_PROXY=True, RATE_LIMIT_PROXY_TOKEN='trusted-private-proxy-token',
                   RATE_LIMIT_ALLOW_DIRECT=False, RATE_LIMIT_PRODUCTION=True)
class ClientIdentityTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    def request(self, **kwargs):
        return self.factory.get('/', REMOTE_ADDR='10.0.0.2', **kwargs)

    def test_valid_contract_canonicalizes_v4_v6_and_mapped_v4(self):
        for supplied, expected in [('203.0.113.2', '203.0.113.2'),
                                   ('2001:0db8::1', '2001:db8::1'),
                                   ('::ffff:203.0.113.2', '203.0.113.2')]:
            request = self.request(HTTP_X_MOBSER_CLIENT_IP=supplied,
                                   HTTP_X_MOBSER_PROXY_TOKEN='trusted-private-proxy-token')
            self.assertEqual(get_client_ip(request, strict=True), expected)

    def test_browser_forwarding_headers_cannot_select_identity(self):
        request = self.request(HTTP_X_FORWARDED_FOR='203.0.113.99',
                               HTTP_X_MOBSER_CLIENT_IP='203.0.113.99', HTTP_X_MOBSER_PROXY_TOKEN='forged')
        self.assertEqual(get_client_ip(request), '10.0.0.2')
        with self.assertRaises(RateLimitUnavailable):
            get_client_ip(request, strict=True)

    def test_missing_or_malformed_provenance_is_503_on_strict_routes(self):
        for ip in ('not-an-ip', '1.2.3.4, 5.6.7.8', 'fe80::1%eth0', ''):
            with self.assertRaises(RateLimitUnavailable):
                get_client_ip(self.request(HTTP_X_MOBSER_CLIENT_IP=ip,
                    HTTP_X_MOBSER_PROXY_TOKEN='trusted-private-proxy-token'), strict=True)
        with self.assertRaises(RateLimitUnavailable):
            get_client_ip(self.request(), strict=True)

    @override_settings(RATE_LIMIT_ALLOW_DIRECT=True)
    def test_production_cannot_relax_missing_identity(self):
        with self.assertRaises(RateLimitUnavailable):
            get_client_ip(self.request(), strict=True)

    @override_settings(RATE_LIMIT_PRODUCTION=False, RATE_LIMIT_ALLOW_DIRECT=True, RATE_LIMIT_TRUST_PROXY=False)
    def test_explicit_development_direct_mode_uses_peer_or_unknown(self):
        self.assertEqual(get_client_ip(self.request(HTTP_X_FORWARDED_FOR='203.0.113.99'), strict=True), '10.0.0.2')
        request = self.request()
        request.META.pop('REMOTE_ADDR')
        self.assertEqual(get_client_ip(request, strict=True), 'unknown-origin')
