"""Webhook transport: validate every DNS answer, then connect to that exact IP."""

import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit

import certifi
import urllib3


class WebhookTransportError(Exception):
    """Safe to persist; never includes customer URLs or response bodies."""


def _parse_url(url):
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) <= 32 or ord(c) >= 127 for c in url):
        raise ValueError('Use an ASCII HTTPS webhook URL of at most 2048 characters.')
    try:
        parts = urlsplit(url)
        host = parts.hostname
        if (
            parts.scheme != 'https' or not host or parts.username is not None
            or parts.password is not None or parts.fragment or parts.port not in (None, 443)
            or '\\' in url or '%' in host
        ):
            raise ValueError
        # DNS names only. IP literals and ambiguous alternative numeric IP forms
        # are unnecessary for developer callbacks and complicate URL handling.
        if len(host) > 253 or '.' not in host or not re.fullmatch(
            r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}', host
        ):
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise ValueError('Webhook URL must use a public DNS name, HTTPS port 443, and no credentials or fragment.') from exc
    return parts, host


def _public_addresses(host):
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError('Webhook hostname could not be resolved.') from exc
    addresses = []
    for _, _, _, _, sockaddr in answers:
        address = ipaddress.ip_address(sockaddr[0])
        effective = getattr(address, 'ipv4_mapped', None) or address
        if (
            not effective.is_global or effective.is_multicast or effective.is_reserved
            or effective.is_loopback or effective.is_link_local or effective.is_unspecified
            # IPv6 transition mechanisms can encode destinations with different
            # routing semantics. Accept native public unicast addresses only.
            or (address.version == 6 and (address.sixtofour or address.teredo))
        ):
            raise ValueError('Webhook hostname must resolve only to public unicast addresses.')
        addresses.append(str(address))
    if not addresses:
        raise ValueError('Webhook hostname has no public addresses.')
    return list(dict.fromkeys(addresses))


def validate_webhook_url(url):
    parts, host = _parse_url(url)
    _public_addresses(host)
    return urlunsplit(('https', host, parts.path or '/', parts.query, ''))


def deliver_webhook(url, body, headers):
    """Return the HTTP status; redirects and hidden transport retries are disabled.

    A new pool connects to one validated address without resolving the hostname
    again. Certificate validation, TLS SNI and Host still use the original name.
    Response bodies are discarded, so callbacks cannot consume unbounded memory.
    """
    try:
        parts, host = _parse_url(url)
        address = _public_addresses(host)[0]
    except ValueError as exc:
        raise WebhookTransportError('webhook_destination_rejected') from exc
    request_headers = {**headers, 'Host': host, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity'}
    pool = urllib3.HTTPSConnectionPool(
        address, port=443, server_hostname=host, assert_hostname=host,
        cert_reqs='CERT_REQUIRED', ca_certs=certifi.where(),
        timeout=urllib3.Timeout(connect=5, read=10, total=15), maxsize=1,
    )
    response = None
    try:
        response = pool.urlopen(
            'POST', urlunsplit(('', '', parts.path or '/', parts.query, '')),
            body=body, headers=request_headers, redirect=False, retries=False,
            preload_content=False, assert_same_host=False,
        )
        return response.status
    except (urllib3.exceptions.HTTPError, OSError, ValueError) as exc:
        raise WebhookTransportError('webhook_delivery_failed') from exc
    finally:
        if response is not None:
            response.close()
        pool.close()
