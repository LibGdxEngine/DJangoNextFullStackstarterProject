"""The engine's browser-free helpers and the tools built on them, driven with a fake
browser context: throttle, retry, cache, rendering, the fetch tools, the search API and
the CAPTCHA hints. Nothing here starts Chromium."""
import asyncio
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from django.test import SimpleTestCase
from langchain_core.messages import ToolMessage

from product.browser_agent.engine import browser_tools
from product.browser_agent.engine.agent_middleware import PAGE_TOOLS, TRACKED_TOOLS, TrimOldSnapshots, _outcome
from product.browser_agent.engine.browser_tools import (
    MAX_CHARS, HostThrottle, HttpCache, SearchStats, brave_params, brave_search, bumped_delay, cache_policy,
    captcha_hint, captcha_solver, decode_body, format_search_results, html_to_text, is_transient_error,
    looks_like_bot_check, make_browser_tools, next_delay, parse_brave_results, parse_retry_after, render_fetched,
    retry_delay, roles_for_desc, run_fetches, throttle_host, unreachable_reason,
)
from product.browser_agent.engine.packs import load_pack
from product.browser_agent.engine.policy import Policy, PolicyGuard, classify
from product.browser_agent.services import system_prompt

ENGINE = 'product.browser_agent.engine.browser_tools'
HTML = b'<html><head><title>Acme</title></head><body><main><h1>Hello</h1><p>hello world from acme</p></main></body></html>'


class StubResponse:
    """What context.request.get returns, as far as _http_get looks at it."""

    def __init__(self, status, body=b'', headers=None):
        self.status = status
        self._body = body
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}

    async def body(self):
        return self._body

    async def dispose(self):
        pass


def page_response(url='https://example.com/', title='Acme', text='hello world from acme'):
    body = f'<html><head><title>{title}</title></head><body><main><p>{text}</p></main></body></html>'.encode()
    return StubResponse(200, body, {'content-type': 'text/html; charset=utf-8'})


def fake_session(responses):
    """A session whose context.request.get answers from `responses` (a list, or a function
    of the URL) and whose throttle never sleeps."""
    get = AsyncMock(side_effect=responses)
    session = SimpleNamespace(
        url_allowed=lambda url: 'blocked.example' not in url,
        throttle=HostThrottle(0, 0, 0), http_cache=HttpCache(), search_stats=SearchStats(),
        _fetch_limiter=asyncio.Semaphore(6), waits=[], lock=asyncio.Lock(), page=None,
        element_frames={}, element_descs={}, snapshot_mode='list', fast_waits=False, page_gate=False,
        blocked=[], popup_closed=False, notes=[], host_failures={}, unreachable={}, _last_read=None,
        vision=False, headless=True,
        context=SimpleNamespace(request=SimpleNamespace(get=get)),
    )
    return session


class ToolHarness:
    """The tools of a fake session, by name, plus a temp workspace."""

    def __init__(self, test, responses):
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        self.session = fake_session(responses)
        self.tools = {t.name: t for t in make_browser_tools(
            self.session, screenshot_dir=str(Path(self.tmp.name) / 'shots'), files_dir=self.tmp.name)}
        self.get = self.session.context.request.get

    def run(self, name, **args):
        return asyncio.run(self.tools[name].ainvoke(args))


class ThrottleTests(SimpleTestCase):
    def test_host_folds_www_and_lowercases(self):
        self.assertEqual(throttle_host('https://WWW.Example.com/a'), 'example.com')
        self.assertEqual(throttle_host('https://api.example.com/a'), 'api.example.com')

    def test_next_delay_moves_toward_latency_over_target_concurrency(self):
        # target = 3.0 / 1.5 = 2.0; the average 1.5 is below it, so the delay goes straight to 2.0
        self.assertAlmostEqual(next_delay(1.0, 3.0, 200, target_concurrency=1.5, min_delay=0, max_delay=60), 2.0)
        # from above the target it moves halfway down
        self.assertAlmostEqual(next_delay(5.0, 3.0, 200, target_concurrency=1.5, min_delay=0, max_delay=60), 3.5)

    def test_next_delay_never_lowers_for_non_200(self):
        self.assertEqual(next_delay(2.0, 0.1, 503, target_concurrency=1.0, min_delay=0, max_delay=60), 2.0)
        self.assertLess(next_delay(2.0, 0.1, 200, target_concurrency=1.0, min_delay=0, max_delay=60), 2.0)

    def test_next_delay_is_clamped(self):
        self.assertEqual(next_delay(0.1, 0.01, 200, target_concurrency=1.0, min_delay=0.3, max_delay=12), 0.3)
        self.assertEqual(next_delay(1.0, 100.0, 200, target_concurrency=1.0, min_delay=0.3, max_delay=12), 12)

    def test_bumped_delay_doubles_and_honours_retry_after(self):
        self.assertEqual(bumped_delay(1.0, None, start=1.0, max_delay=12), 2.0)
        self.assertEqual(bumped_delay(1.0, '30', start=1.0, max_delay=12), 12)
        self.assertEqual(bumped_delay(0.0, None, start=0.5, max_delay=12), 1.0)

    def test_host_throttle_waits_per_host(self):
        throttle = HostThrottle(start=1.0, min_delay=0.3, max_delay=12)
        self.assertEqual(throttle.wait_time('example.com', 0.0), 0.0)   # first request: no wait
        throttle.mark_sent('example.com', 0.0)
        self.assertAlmostEqual(throttle.wait_time('www.example.com', 0.2), 0.8)
        self.assertEqual(throttle.wait_time('other.com', 0.2), 0.0)
        throttle.record('example.com', 0.1, 429)
        self.assertEqual(throttle.delay('example.com'), 2.0)

    def test_slot_serialises_one_host_and_sleeps_through_the_callable(self):
        throttle = HostThrottle(start=0.05, min_delay=0, max_delay=1)
        slept, order = [], []

        async def sleep(seconds):
            slept.append(seconds)

        async def use(label):
            async with throttle.slot('a.com', sleep):
                order.append(f'{label} in')
                await asyncio.sleep(0.01)
                order.append(f'{label} out')

        async def both():
            await asyncio.gather(use('x'), use('y'))

        asyncio.run(both())
        self.assertEqual(order, ['x in', 'x out', 'y in', 'y out'])
        self.assertEqual(len(slept), 1)
        self.assertGreater(slept[0], 0)


class RetryTests(SimpleTestCase):
    def test_retry_delay_backs_off_and_caps(self):
        self.assertTrue(1.0 <= retry_delay(0) <= 1.3)
        self.assertTrue(2.0 <= retry_delay(1) <= 2.3)
        self.assertEqual(retry_delay(5, cap=10), 10)
        self.assertEqual(retry_delay(0, '3'), 3.0)

    def test_parse_retry_after_seconds_and_http_date(self):
        self.assertEqual(parse_retry_after('120'), 120.0)
        now = datetime(2015, 10, 21, 7, 27, 0, tzinfo=timezone.utc).timestamp()
        self.assertEqual(parse_retry_after('Wed, 21 Oct 2015 07:28:00 GMT', now=now), 60.0)
        self.assertIsNone(parse_retry_after('soon'))
        self.assertIsNone(parse_retry_after(None))

    def test_is_transient_error_matches_dropped_connections_only(self):
        self.assertTrue(is_transient_error(Exception('Page.goto: net::ERR_CONNECTION_RESET at https://x')))
        self.assertFalse(is_transient_error(Exception('Page.goto: net::ERR_NAME_NOT_RESOLVED')))
        self.assertFalse(is_transient_error(browser_tools.PWTimeout('Timeout 45000ms exceeded')))

    def test_fetch_page_retries_503_then_returns_the_page(self):
        h = ToolHarness(self, [StubResponse(503, b'busy'), page_response()])
        with patch(f'{ENGINE}.retry_delay', return_value=0.0):
            out = h.run('fetch_page', url='https://example.com/')
        self.assertIn('Title: Acme', out)
        self.assertIn('retried 1x', out)
        self.assertIn('hello world from acme', out)
        self.assertEqual(h.get.await_count, 2)
        self.assertIn('retry', [name for name, _ in h.session.waits])

    def test_fetch_page_never_retries_404(self):
        h = ToolHarness(self, [StubResponse(404, b'<html><title>Not found</title></html>')])
        out = h.run('fetch_page', url='https://example.com/missing')
        self.assertTrue(out.startswith('Fetch failed: HTTP 404 for https://example.com/missing.'), out)
        self.assertNotIn('bot check', out)
        self.assertEqual(h.get.await_count, 1)

    def test_fetch_page_stops_after_two_retries(self):
        h = ToolHarness(self, [StubResponse(503), StubResponse(503), StubResponse(503)])
        with patch(f'{ENGINE}.retry_delay', return_value=0.0):
            out = h.run('fetch_page', url='https://example.com/')
        self.assertTrue(out.startswith('Fetch failed: HTTP 503'), out)
        self.assertEqual(h.get.await_count, 3)

    def test_fetch_page_names_a_bot_check(self):
        body = b'<html><title>Just a moment...</title><body>Checking your browser before accessing</body></html>'
        h = ToolHarness(self, [StubResponse(403, body, {'content-type': 'text/html'})])
        out = h.run('fetch_page', url='https://example.com/')
        self.assertIn('bot check; open it with browse', out)

    def test_fetch_page_retries_a_dropped_connection(self):
        h = ToolHarness(self, [Exception('net::ERR_CONNECTION_RESET'), page_response()])
        with patch(f'{ENGINE}.retry_delay', return_value=0.0):
            out = h.run('fetch_page', url='https://example.com/')
        self.assertIn('Title: Acme', out)
        self.assertEqual(h.get.await_count, 2)


class UnreachableHostTests(SimpleTestCase):
    """A host that cannot be reached twice is skipped for the rest of the run, so the
    agent does not spend a step (and the retries inside it) on it again and again."""

    def test_unreachable_reason_names_connection_failures_only(self):
        self.assertIn('drops the connection', unreachable_reason('Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at x'))
        self.assertIn('does not answer', unreachable_reason('APIRequestContext.get: Timeout 20000ms exceeded.'))
        self.assertIn('does not resolve', unreachable_reason('getaddrinfo ENOTFOUND www.btoga.com'))
        self.assertIn('TLS', unreachable_reason('write EPROTO ...:SSL routines:ssl3_read_bytes:tlsv1 unrecognized name'))
        self.assertIsNone(unreachable_reason('HTTP 404 for https://x/'))

    def test_second_fetch_failure_gives_up_on_the_host_and_the_third_is_skipped(self):
        h = ToolHarness(self, browser_tools.PWTimeout('APIRequestContext.get: Timeout 20000ms exceeded.'))
        first = h.run('fetch_page', url='https://noon.example/search?q=a')
        self.assertTrue(first.startswith('Fetch failed: TimeoutError'), first)
        self.assertNotIn('Skipped', first)
        second = h.run('fetch_page', url='https://www.noon.example/other')
        self.assertIn('Skipped: noon.example is unreachable from this browser (it does not answer in time; '
                      '2 attempts failed)', second)
        self.assertEqual(h.get.await_count, 2)
        third = h.run('fetch_page', url='https://noon.example/third')
        self.assertTrue(third.startswith('Skipped: noon.example is unreachable'), third)
        self.assertEqual(h.get.await_count, 2)   # no request went out
        # Other hosts are unaffected.
        self.assertEqual(h.session.unreachable, {'noon.example': 'it does not answer in time'})

    def test_fetch_many_skips_a_dead_host_without_requests(self):
        h = ToolHarness(self, lambda url, **kw: page_response(url))
        h.session.unreachable['dead.example'] = 'it drops the connection'
        h.session.host_failures['dead.example'] = 2
        out = h.run('fetch_many', urls=['https://dead.example/a', 'https://ok.example/'])
        self.assertIn('1. https://dead.example/a -- Skipped: dead.example is unreachable', out)
        self.assertEqual(h.get.await_count, 1)

    def test_browse_counts_failures_to_open_and_then_skips_the_host(self):
        h = ToolHarness(self, [])
        goto = AsyncMock(side_effect=Exception('Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://noon.example/'))
        h.session.page = SimpleNamespace(goto=goto, is_closed=lambda: False, url='about:blank')
        with patch(f'{ENGINE}.retry_delay', return_value=0.0):
            first = h.run('browse', url='https://noon.example/a')
            second = h.run('browse', url='https://noon.example/b')
        self.assertTrue(first.startswith('Failed to open https://noon.example/a'), first)
        self.assertNotIn('Skipped', first)
        self.assertIn('Skipped: noon.example is unreachable from this browser (it drops the connection', second)
        attempts = goto.await_count   # each call retried the dropped connection internally
        third = h.run('browse', url='https://noon.example/c')
        self.assertTrue(third.startswith('Skipped: noon.example is unreachable'), third)
        self.assertEqual(goto.await_count, attempts)


class FetchHintTests(SimpleTestCase):
    """Fetch results say when a URL was guessed or a page needs the browser, so the
    model changes approach instead of trying variations."""

    def test_404_on_a_search_looking_url_says_not_to_guess(self):
        h = ToolHarness(self, [StubResponse(404, b'<html><title>Not found</title></html>')])
        out = h.run('fetch_page', url='https://btech.example/en/search?q=macbook')
        self.assertTrue(out.startswith('Fetch failed: HTTP 404 for https://btech.example/en/search?q=macbook.'), out)
        self.assertIn('guessed URL', out)
        self.assertIn('site:btech.example', out)

    def test_404_on_a_plain_page_url_gets_no_guess_hint(self):
        h = ToolHarness(self, [StubResponse(404, b'<html><title>Not found</title></html>')])
        out = h.run('fetch_page', url='https://example.com/missing')
        self.assertNotIn('guessed', out)

    def test_a_script_drawn_shell_is_pointed_out(self):
        body = (b'<html><head><title>Shop</title><script>' + b'x' * 60000 + b'</script></head>'
                b'<body><main><p>Skip to content</p></main></body></html>')
        h = ToolHarness(self, [StubResponse(200, body, {'content-type': 'text/html'})])
        out = h.run('fetch_page', url='https://shop.example/')
        self.assertIn('drawn by scripts', out)
        self.assertIn('use browse for this page', out)

    def test_an_ordinary_page_gets_no_shell_hint(self):
        h = ToolHarness(self, [page_response()])
        out = h.run('fetch_page', url='https://example.com/')
        self.assertNotIn('drawn by scripts', out)


class CacheTests(SimpleTestCase):
    def test_cache_policy_parses_cache_control(self):
        self.assertEqual(cache_policy({'cache-control': 'no-store'}), (False, None))
        self.assertEqual(cache_policy({'cache-control': 'no-cache'}), (True, 0.0))
        self.assertEqual(cache_policy({'cache-control': 'public, max-age=60'}), (True, 60.0))
        self.assertEqual(cache_policy({}), (True, None))

    def _entry(self, url, body=b'x', headers=None):
        return browser_tools.CacheEntry(url=url, status=200, headers=headers or {}, body=body,
                                        content_type='text/html', stored_at=0.0)

    def test_fresh_entry_is_served_and_expires_after_ttl(self):
        cache = HttpCache(ttl_s=10)
        cache.store('https://a/', self._entry('https://a/'), now=0.0)
        entry, fresh = cache.lookup('https://a/', now=5.0)
        self.assertIsNotNone(entry)
        self.assertTrue(fresh)
        _, fresh = cache.lookup('https://a/', now=11.0)
        self.assertFalse(fresh)
        self.assertEqual(cache.hits, 1)

    def test_no_store_is_not_cached_and_max_age_wins_over_ttl(self):
        cache = HttpCache(ttl_s=1000)
        self.assertFalse(cache.store('https://a/', self._entry('https://a/', headers={'cache-control': 'no-store'}), 0.0))
        cache.store('https://b/', self._entry('https://b/', headers={'cache-control': 'max-age=5'}), 0.0)
        self.assertFalse(cache.lookup('https://b/', now=6.0)[1])

    def test_evicts_oldest_when_over_bounds(self):
        cache = HttpCache(ttl_s=10, max_entries=2)
        for n in range(3):
            cache.store(f'https://{n}/', self._entry(f'https://{n}/'), now=float(n))
        self.assertEqual(cache.lookup('https://0/', now=3.0), (None, False))
        self.assertIsNotNone(cache.lookup('https://2/', now=3.0)[0])

    def test_second_fetch_is_served_from_the_cache_and_fresh_bypasses_it(self):
        h = ToolHarness(self, [page_response(), page_response(text='changed')])
        first = h.run('fetch_page', url='https://example.com/')
        second = h.run('fetch_page', url='https://example.com/')
        self.assertEqual(h.get.await_count, 1)
        self.assertIn('cached 0 s ago', second)
        self.assertNotIn('cached', first)
        third = h.run('fetch_page', url='https://example.com/', fresh=True)
        self.assertEqual(h.get.await_count, 2)
        self.assertIn('changed', third)

    def test_stale_entry_is_revalidated_and_304_reuses_the_body(self):
        h = ToolHarness(self, [
            StubResponse(200, HTML, {'content-type': 'text/html', 'etag': '"abc"'}),
            StubResponse(304, b'', {}),
        ])
        h.session.http_cache = HttpCache(ttl_s=0)   # everything is stale at once
        h.run('fetch_page', url='https://example.com/')
        out = h.run('fetch_page', url='https://example.com/')
        self.assertEqual(h.get.await_count, 2)
        self.assertEqual(h.get.await_args_list[1].kwargs['headers']['If-None-Match'], '"abc"')
        self.assertIn('hello world from acme', out)
        self.assertIn('cached', out)
        self.assertEqual(h.session.http_cache.revalidated, 1)

    def test_cache_key_is_the_final_url_with_an_alias_for_the_requested_one(self):
        h = ToolHarness(self, [
            StubResponse(301, b'', {'location': '/final'}),
            page_response(),
        ])
        out = h.run('fetch_page', url='https://example.com/start')
        self.assertIn('URL: https://example.com/final', out)
        self.assertIn('via 1 redirect', out)
        again = h.run('fetch_page', url='https://example.com/start')
        self.assertEqual(h.get.await_count, 2)
        self.assertIn('cached', again)
        direct = h.run('fetch_page', url='https://example.com/final')
        self.assertEqual(h.get.await_count, 2)
        self.assertIn('cached', direct)

    def test_redirect_to_a_blocked_host_is_refused(self):
        h = ToolHarness(self, [StubResponse(302, b'', {'location': 'https://blocked.example/x'})])
        out = h.run('fetch_page', url='https://example.com/go')
        self.assertTrue(out.startswith('Blocked: blocked.example'), out)


class RenderingTests(SimpleTestCase):
    def test_html_to_text_keeps_structure_and_drops_scripts_and_hidden_content(self):
        markup = ('<html><head><title> Acme  Inc </title><style>p{}</style></head><body>'
                  '<script>alert(1)</script><div hidden>secret</div><span aria-hidden="true">icon</span>'
                  '<h2>Products</h2><ul><li>One</li><li>Two</li></ul>'
                  '<a href="/contact">Contact us</a><a href="javascript:void(0)">x</a></body></html>')
        text, title, links = html_to_text(markup, 'https://acme.com/')
        self.assertEqual(title, 'Acme Inc')
        self.assertIn('## Products', text)
        self.assertIn('- One', text)
        self.assertNotIn('alert', text)
        self.assertNotIn('secret', text)
        self.assertNotIn('icon', text)
        self.assertEqual(links, [('Contact us', 'https://acme.com/contact')])

    def test_html_to_text_prefers_main_when_it_is_long_enough(self):
        body = 'word ' * 60
        markup = f'<body><nav>Menu Home About</nav><main><p>{body}</p></main><footer>Copyright footer</footer></body>'
        text, _, _ = html_to_text(markup)
        self.assertIn('word', text)
        self.assertNotIn('Copyright', text)
        short = '<body><nav>Menu</nav><main>short</main><footer>Copyright</footer></body>'
        self.assertIn('Copyright', html_to_text(short)[0])

    def test_decode_body_uses_the_header_then_the_meta_charset(self):
        self.assertEqual(decode_body(b'caf\xe9', 'text/html; charset=iso-8859-1'), 'café')
        self.assertEqual(decode_body(b'<meta charset="iso-8859-1">caf\xe9', 'text/html'), '<meta charset="iso-8859-1">café')
        self.assertEqual(decode_body('café'.encode(), ''), 'café')

    def test_render_fetched_pretty_prints_and_truncates_json(self):
        text, _, kind = render_fetched(b'{"a": [1, 2]}', 'application/json', 'https://x/api', 'auto', 500)
        self.assertEqual(kind, 'json')
        self.assertIn('"a": [', text)
        long = json.dumps({'k': 'v' * 1000}).encode()
        text, _, _ = render_fetched(long, 'application/json', 'https://x/api', 'auto', 300)
        self.assertIn('truncated', text)
        text, _, kind = render_fetched(b'[1,2]', 'text/plain', 'https://x/t', 'text', 300)
        self.assertEqual(kind, 'text')

    def test_render_fetched_flags_files(self):
        self.assertEqual(render_fetched(b'%PDF', 'application/pdf', 'https://x/a', 'auto', 100)[2], 'pdf')
        self.assertEqual(render_fetched(b'\x89PNG', 'image/png', 'https://x/a.png', 'auto', 100)[2], 'binary')
        self.assertEqual(render_fetched(b'\x00\x01', '', 'https://x/blob', 'auto', 100)[2], 'binary')

    def test_render_fetched_lists_same_site_links_on_request(self):
        markup = b'<body><p>hi</p><a href="/a">A</a><a href="https://other.com/b">B</a></body>'
        text, _, _ = render_fetched(markup, 'text/html', 'https://site.com/', 'auto', 500, links=True)
        self.assertIn('- A -> https://site.com/a', text)
        self.assertNotIn('other.com', text)

    def test_looks_like_bot_check(self):
        self.assertTrue(looks_like_bot_check(503, 'Just a moment...', 'Checking your browser'))
        self.assertTrue(looks_like_bot_check(200, '', 'Our systems have detected unusual traffic from your network'))
        self.assertFalse(looks_like_bot_check(404, 'Not Found', 'The page you requested does not exist'))
        self.assertFalse(looks_like_bot_check(200, 'Blog', 'How we beat the captcha problem in 2010'))


class FetchManyTests(SimpleTestCase):
    def test_run_fetches_caps_parallelism_and_the_throttle_serialises_a_host(self):
        throttle = HostThrottle(0, 0, 0)
        active, per_host = {'now': 0, 'max': 0}, {}
        peak_per_host = {}

        async def sleep(_):
            pass

        async def fetch_one(url):
            host = throttle_host(url)
            async with throttle.slot(host, sleep):
                active['now'] += 1
                per_host[host] = per_host.get(host, 0) + 1
                active['max'] = max(active['max'], active['now'])
                peak_per_host[host] = max(peak_per_host.get(host, 0), per_host[host])
                await asyncio.sleep(0.01)
                per_host[host] -= 1
                active['now'] -= 1
                return url

        urls = [f'https://h{n % 3}.com/p{n}' for n in range(12)]
        out = asyncio.run(run_fetches(urls, fetch_one, limiter=asyncio.Semaphore(4), deadline_s=5))
        self.assertEqual(out, urls)
        self.assertLessEqual(active['max'], 4)
        self.assertEqual(max(peak_per_host.values()), 1)

    def test_run_fetches_reports_timeouts_and_exceptions_in_place(self):
        async def fetch_one(url):
            if 'slow' in url:
                await asyncio.sleep(5)
            if 'bad' in url:
                raise ValueError('nope')
            return url

        out = asyncio.run(run_fetches(['https://a/ok', 'https://a/slow', 'https://a/bad'], fetch_one,
                                      limiter=asyncio.Semaphore(4), deadline_s=0.2))
        self.assertEqual(out[0], 'https://a/ok')
        self.assertIsNone(out[1])
        self.assertIsInstance(out[2], ValueError)

    def test_fetch_many_marks_blocked_urls_caps_at_20_and_saves_json(self):
        def respond(url, **kwargs):
            return page_response(url, title=f'Page {url.rsplit("/", 1)[-1]}')

        h = ToolHarness(self, respond)
        urls = [f'https://site{n}.com/about' for n in range(24)] + ['https://blocked.example/x']
        urls = urls[:19] + ['https://blocked.example/x'] + urls[19:24]
        out = h.run('fetch_many', urls=urls, max_chars_each=100, save_as='research/sites.json')
        self.assertTrue(out.startswith('Fetched 19 of 20 pages (1 blocked). 5 more URLs were skipped'), out)
        self.assertIn('Saved full text of 19 pages as JSON to research/sites.json', out)
        self.assertIn('https://blocked.example/x -- Blocked: blocked.example is not in ALLOWED_DOMAINS.', out)
        self.assertIn('1. Page about -- https://site0.com/about [200,', out)
        rows = json.loads((Path(h.tmp.name) / 'research' / 'sites.json').read_text(encoding='utf-8'))
        self.assertEqual(len(rows), 20)
        self.assertEqual(rows[0]['title'], 'Page about')
        self.assertIn('hello world', rows[0]['text'])
        self.assertEqual(h.get.await_count, 19)
        self.assertLessEqual(len(out), MAX_CHARS * 2 + 200)
        self.assertTrue(_outcome(out).startswith('Fetched 19 of 20 pages'))

    def test_fetch_many_dedupes_and_reports_failures(self):
        def respond(url, **kwargs):
            return page_response(url) if 'a.com' in url else StubResponse(404, b'gone')

        h = ToolHarness(self, respond)
        out = h.run('fetch_many', urls=['https://a.com/', 'https://a.com/', 'https://b.com/'])
        self.assertTrue(out.startswith('Fetched 1 of 2 pages (1 failed).'), out)
        self.assertIn('2. https://b.com/ -- Fetch failed: HTTP 404', out)
        self.assertEqual(h.get.await_count, 2)


class BraveSearchTests(SimpleTestCase):
    def _client(self, handler):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def test_brave_params_cap_count_and_map_language_and_country(self):
        params = brave_params('q', 50, language='ar-EG', country='eg', freshness='pw')
        self.assertEqual((params['count'], params['search_lang'], params['country'], params['freshness']),
                         (20, 'ar', 'EG', 'pw'))
        self.assertNotIn('freshness', brave_params('q', 5, language='', country='', freshness='bogus'))
        self.assertNotIn('country', brave_params('q', 5, language='en-US', country=''))

    def test_parse_brave_results_maps_fields_and_skips_entries_without_url(self):
        data = {'web': {'results': [
            {'title': 'A &amp; B', 'url': 'https://a/', 'description': 'first'},
            {'title': 'no url'},
            {'title': 'C', 'url': 'https://c/'},
        ]}}
        self.assertEqual(parse_brave_results(data, 5), [
            {'title': 'A & B', 'url': 'https://a/', 'snippet': 'first'},
            {'title': 'C', 'url': 'https://c/', 'snippet': ''},
        ])
        self.assertEqual(len(parse_brave_results(data, 1)), 1)
        self.assertEqual(parse_brave_results({}, 5), [])

    def test_format_search_results_keeps_the_layout(self):
        out = format_search_results('x', 'brave', [{'title': 'T', 'url': 'https://t/', 'snippet': 's'},
                                                   {'title': 'U', 'url': 'https://u/', 'snippet': ''}])
        self.assertEqual(out.split('\n')[0], "Top 2 results for 'x' (brave):")
        self.assertIn('1. T\n   https://t/\n   s', out)
        self.assertTrue(out.endswith('2. U\n   https://u/'))

    def test_brave_search_sends_the_key_and_counts_stats(self):
        seen = {}

        def handler(request):
            seen['token'] = request.headers.get('X-Subscription-Token')
            seen['q'] = request.url.params.get('q')
            return httpx.Response(200, json={'web': {'results': [
                {'title': 'T', 'url': 'https://t/', 'description': 'd'}]}})

        stats = SearchStats()
        with patch(f'{ENGINE}.BRAVE_SEARCH_API_KEY', 'key'), patch(f'{ENGINE}._brave_client', self._client(handler)):
            results, problem = asyncio.run(brave_search('quran academy', 5, stats=stats))
        self.assertEqual(problem, '')
        self.assertEqual(results, [{'title': 'T', 'url': 'https://t/', 'snippet': 'd'}])
        self.assertEqual((seen['token'], seen['q']), ('key', 'quran academy'))
        self.assertEqual((stats.calls, stats.answered, stats.results, stats.errors), (1, 1, 1, 0))

    def test_brave_search_retries_429_once_then_reports(self):
        calls = {'n': 0}

        def handler(request):
            calls['n'] += 1
            return httpx.Response(429, headers={'Retry-After': '0'})

        with patch(f'{ENGINE}.BRAVE_SEARCH_API_KEY', 'key'), patch(f'{ENGINE}._brave_client', self._client(handler)):
            results, problem = asyncio.run(brave_search('q', 5, stats=SearchStats()))
        self.assertIsNone(results)
        self.assertEqual(problem, 'brave: rate limited')
        self.assertEqual(calls['n'], 2)

    def test_brave_search_401_disables_the_api_for_the_session(self):
        calls = {'n': 0}

        def handler(request):
            calls['n'] += 1
            return httpx.Response(401, json={'error': 'bad key'})

        stats = SearchStats()
        with patch(f'{ENGINE}.BRAVE_SEARCH_API_KEY', 'key'), patch(f'{ENGINE}._brave_client', self._client(handler)):
            asyncio.run(brave_search('q', 5, stats=stats))
            results, problem = asyncio.run(brave_search('q2', 5, stats=stats))
        self.assertIn('refused the key', stats.disabled_reason)
        self.assertIsNone(results)
        self.assertIn('refused the key', problem)
        self.assertEqual(calls['n'], 1)

    def test_brave_search_is_off_without_a_key(self):
        with patch(f'{ENGINE}.BRAVE_SEARCH_API_KEY', ''):
            self.assertEqual(asyncio.run(brave_search('q', 5)), (None, 'brave: BRAVE_SEARCH_API_KEY is not set'))

    def _search_page(self, results, body='nothing here'):
        page = SimpleNamespace()
        page.set_extra_http_headers = AsyncMock()
        page.goto = AsyncMock(return_value=SimpleNamespace(status=200))
        page.locator = lambda selector: SimpleNamespace(first=SimpleNamespace(wait_for=AsyncMock()))
        page.evaluate = AsyncMock(return_value=results)
        page.inner_text = AsyncMock(return_value=body)
        page.close = AsyncMock()
        return page

    def test_web_search_uses_the_api_and_never_opens_a_tab(self):
        h = ToolHarness(self, [])
        h.session.context.new_page = AsyncMock()
        with patch(f'{ENGINE}.brave_enabled', return_value=True), \
                patch(f'{ENGINE}.brave_search', AsyncMock(return_value=(
                    [{'title': 'T', 'url': 'https://t/', 'snippet': 's'}], ''))):
            out = h.run('web_search', query='q')
        self.assertTrue(out.startswith("Top 1 results for 'q' (brave):"), out)
        h.session.context.new_page.assert_not_awaited()
        self.assertIn('search_api', [name for name, _ in h.session.waits])

    def test_web_search_falls_back_to_a_search_tab_when_the_api_fails(self):
        h = ToolHarness(self, [])
        page = self._search_page([{'title': 'T', 'url': 'https://t/', 'snippet': 's'}])
        h.session.context.new_page = AsyncMock(return_value=page)
        with patch(f'{ENGINE}.brave_enabled', return_value=True), \
                patch(f'{ENGINE}.brave_search', AsyncMock(return_value=(None, 'brave failed: boom'))):
            out = h.run('web_search', query='q')
        self.assertTrue(out.startswith("Top 1 results for 'q' (bing):"), out)
        page.close.assert_awaited()

        page = self._search_page([])
        h.session.context.new_page = AsyncMock(return_value=page)
        with patch(f'{ENGINE}.brave_enabled', return_value=True), \
                patch(f'{ENGINE}.brave_search', AsyncMock(return_value=(None, 'brave failed: boom'))):
            out = h.run('web_search', query='q')
        self.assertTrue(out.startswith("Search for 'q' failed: brave failed: boom; bing returned no results"), out)


class WiringTests(SimpleTestCase):
    """Prompt, policy, middleware and packs know about the new tools."""

    def test_product_prompt_teaches_the_fetch_tools_and_no_longer_says_bing(self):
        prompt = system_prompt(None)
        self.assertIn('`fetch_many`', prompt)
        self.assertIn('is a search API', prompt)
        self.assertNotIn('runs on Bing', prompt)

    def test_rate_limits_count_fetch_page_and_every_fetch_many_url(self):
        guard = PolicyGuard(Policy(rate_limits={'linkedin.com': '2 page loads / hour'}),
                            SimpleNamespace(element_descs={}, page=None))
        handler = AsyncMock(side_effect=lambda req: ToolMessage(content='ok', tool_call_id='c', name=req.tool_call['name']))

        def call(name, args):
            request = SimpleNamespace(tool_call={'name': name, 'args': args, 'id': 'c'}, state={'messages': []})
            return asyncio.run(guard.awrap_tool_call(request, handler))

        three = [f'https://www.linkedin.com/company/{n}' for n in range(3)]
        refused = call('fetch_many', {'urls': three + ['https://other.com/']})
        self.assertIn('allows 2 more and this call asks for 3', refused.content)
        self.assertEqual(call('fetch_many', {'urls': three[:2]}).content, 'ok')
        self.assertIn('allows 0 more', call('fetch_page', {'url': three[2]}).content)
        self.assertEqual(call('fetch_page', {'url': 'https://other.com/'}).content, 'ok')

    def test_fetch_tools_are_reads(self):
        self.assertIsNone(classify('fetch_page', {'url': 'https://x/'}, None, None))
        self.assertIsNone(classify('fetch_many', {'urls': ['https://x/']}, None, None))

    def test_fetch_tools_are_tracked_but_not_page_scoped(self):
        self.assertTrue({'fetch_page', 'fetch_many'} <= TRACKED_TOOLS)
        self.assertFalse({'fetch_page', 'fetch_many'} & PAGE_TOOLS)

    def test_default_middleware_provides_the_todo_tool_the_prompt_names(self):
        from product.browser_agent.engine.agent import SYSTEM_PROMPT, default_middleware

        self.assertIn('`write_todos`', SYSTEM_PROMPT)
        middleware = default_middleware(fake_session([]))
        tools = [t.name for m in middleware for t in getattr(m, 'tools', [])]
        self.assertIn('write_todos', tools)

    def test_trimmed_fetches_point_back_at_fetch_page(self):
        shrunk = TrimOldSnapshots()._shrink('URL: https://x/\nTitle: T\nFetched: HTTP 200, 1 KB\n\nlots of text')
        self.assertIn('call fetch_page again (it is cached)', shrunk)
        shrunk = TrimOldSnapshots()._shrink('URL: https://x/\nTitle: T\n\nlots of text')
        self.assertIn('call read_current_page', shrunk)

    def test_lead_generation_pack_selects_the_fetch_tools(self):
        self.assertTrue({'fetch_page', 'fetch_many'} <= set(load_pack('lead_generation').tools))

    def test_make_browser_tools_exposes_the_fetch_tools_after_search(self):
        names = [t.name for t in ToolHarness(self, []).tools.values()]
        self.assertEqual(names[:4], ['browse', 'web_search', 'fetch_page', 'fetch_many'])


def fake_page(matches):
    """A page whose numbered element is gone; `matches` is what get_by_role finds."""
    stale = SimpleNamespace(count=AsyncMock(return_value=0))
    none = SimpleNamespace(count=AsyncMock(return_value=0))
    by_role = SimpleNamespace(count=AsyncMock(return_value=len(matches)), nth=lambda i: matches[i])
    frame = SimpleNamespace(
        locator=lambda selector: SimpleNamespace(first=stale) if 'data-agent-id' in selector else none,
        get_by_role=lambda role, name=None: by_role, get_by_label=lambda t: none,
        get_by_placeholder=lambda t: none, get_by_text=lambda t, exact=False: none)
    page = SimpleNamespace(main_frame=frame, frames=[frame], evaluate=AsyncMock(return_value=False),
                           wait_for_timeout=AsyncMock(), is_closed=lambda: False, url='https://x/')
    return page


class StaleElementNumberTests(SimpleTestCase):
    """A number from the last page read that the page has since re-rendered is resolved by
    the role and label it stood for, instead of failing the step."""

    def test_roles_for_desc(self):
        self.assertEqual(roles_for_desc('button', ('link', 'button')), ('button',))
        self.assertEqual(roles_for_desc('text input', ('link',)), ('textbox',))
        self.assertEqual(roles_for_desc('submit input', ('link',)), ('button',))
        self.assertEqual(roles_for_desc('a', ('button',)), ('link',))
        self.assertEqual(roles_for_desc('div', ('link', 'button')), ('link', 'button'))

    def test_stale_number_falls_back_to_the_label_and_says_so_on_the_next_read(self):
        h = ToolHarness(self, [])
        found = SimpleNamespace(is_visible=AsyncMock(return_value=True), scroll_into_view_if_needed=AsyncMock())
        h.session.page = fake_page([found])
        h.session.element_descs = {'35': ('button', 'Post')}
        out = h.run('scroll', element='35')
        self.assertTrue(out.startswith('Scrolled.'), out)
        found.scroll_into_view_if_needed.assert_awaited_once()
        self.assertEqual(h.session.notes, ['(Element [35] had been re-rendered by the page; '
                                           'used the button labelled "Post" instead.)'])

    def test_error_names_the_label_when_nothing_matches_it_either(self):
        h = ToolHarness(self, [])
        h.session.page = fake_page([])
        h.session.element_descs = {'35': ('button', 'Post')}
        out = h.run('scroll', element='35')
        self.assertTrue(out.startswith('No element [35] on this page, and nothing labelled "Post" either.'), out)

    def test_unknown_number_keeps_the_plain_error(self):
        h = ToolHarness(self, [])
        h.session.page = fake_page([])
        out = h.run('scroll', element='35')
        self.assertTrue(out.startswith('No element [35] on this page. Numbers change'), out)


class CaptchaHintTests(SimpleTestCase):
    """Page reads name the tool that clears a bot check, so the agent tries it instead
    of giving up or hopping to another site."""

    def test_solver_per_widget(self):
        self.assertEqual(captcha_solver('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x'),
                         'solve_turnstile')
        self.assertEqual(captcha_solver('https://www.recaptcha.net/recaptcha/api2/anchor?k=1'), 'solve_recaptcha')
        self.assertEqual(captcha_solver('https://www.google.com/recaptcha/enterprise/anchor?k=1'),
                         'solve_recaptcha')
        self.assertIsNone(captcha_solver('https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html'))

    def test_frame_line_names_the_tool(self):
        elements = ('\n\nInteractive elements:\n[1] link "Home"\n'
                    '(CAPTCHA frame from challenges.cloudflare.com: not listed; call solve_turnstile to clear it)')
        hint = captcha_hint('https://example.com/', elements)
        self.assertTrue(hint.startswith('(This page is a bot check. Call `solve_turnstile` once'))

    def test_google_unusual_traffic_page_points_at_recaptcha_before_the_widget_renders(self):
        hint = captcha_hint('https://www.google.com/sorry/index?continue=https://www.google.com/search',
                            '[1] link "Why did this happen?"')
        self.assertIn('`solve_recaptcha`', hint)

    def test_no_hint_for_ordinary_pages_or_widgets_only_a_person_can_clear(self):
        self.assertEqual(captcha_hint('https://www.google.com/search?q=x', '[1] link "Images"'), '')
        self.assertEqual(captcha_hint(
            'https://example.com/',
            '(CAPTCHA frame from hcaptcha.com: not listed; see the CAPTCHA rules)'), '')

    def test_product_prompt_says_to_try_the_solver_first(self):
        prompt = system_prompt(None)
        self.assertIn('(This page is a bot check', prompt)
        self.assertIn('`solve_recaptcha`', prompt)
