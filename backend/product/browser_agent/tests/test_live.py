import asyncio
from unittest.mock import MagicMock, patch

from asgiref.sync import async_to_sync
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.organizations.models import Organization, OrganizationMember
from product.browser_agent.live import LiveScreencast, get_frame, live_key
from product.browser_agent.models import AgentRun

from .test_api import make_user


class FakeCDP:
    def __init__(self):
        self.handlers = {}
        self.sent = []

    def on(self, event, handler):
        self.handlers[event] = handler

    async def send(self, method, params=None):
        self.sent.append(method)

    async def detach(self):
        self.sent.append('detach')


def fake_page(cdp, url):
    page = MagicMock()
    page.url = url

    async def new_cdp_session(target):
        return cdp
    page.context.new_cdp_session = new_cdp_session
    return page


class LiveScreencastTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_publishes_frames_and_follows_tab_switches(self):
        first, second = FakeCDP(), FakeCDP()
        session = MagicMock()
        session.page = fake_page(first, 'https://a.example/')

        async def scenario():
            with patch('product.browser_agent.live.PUBLISH_INTERVAL_S', 0.01):
                live = LiveScreencast(session, 'run-1')
                live.start()
                await asyncio.sleep(0.05)
                first.handlers['Page.screencastFrame']({'data': 'AAA', 'sessionId': 1})
                await asyncio.sleep(0.05)
                frame_a = get_frame('run-1')

                session.page = fake_page(second, 'https://b.example/')
                await asyncio.sleep(0.05)
                second.handlers['Page.screencastFrame']({'data': 'BBB', 'sessionId': 7})
                await asyncio.sleep(0.05)
                frame_b = get_frame('run-1')
                await live.stop()
                return frame_a, frame_b

        frame_a, frame_b = async_to_sync(scenario)()
        self.assertEqual((frame_a['image'], frame_a['url'], frame_a['live']), ('AAA', 'https://a.example/', True))
        self.assertEqual((frame_b['image'], frame_b['url']), ('BBB', 'https://b.example/'))
        self.assertGreater(frame_b['seq'], frame_a['seq'])
        self.assertIn('Page.startScreencast', first.sent)
        self.assertIn('Page.stopScreencast', first.sent)  # detached from the old tab
        self.assertIn('Page.screencastFrameAck', second.sent)
        final = get_frame('run-1')
        self.assertFalse(final['live'])
        self.assertEqual(final['image'], 'BBB')

    def test_attach_failure_does_not_raise(self):
        session = MagicMock()
        session.page.context.new_cdp_session.side_effect = RuntimeError('page closed')

        async def scenario():
            with patch('product.browser_agent.live.PUBLISH_INTERVAL_S', 0.01):
                live = LiveScreencast(session, 'run-2')
                live.start()
                await asyncio.sleep(0.03)
                await live.stop()

        async_to_sync(scenario)()
        self.assertIsNone(get_frame('run-2'))


class LiveEndpointTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('viewer@example.com')
        self.org = Organization.objects.create(name='Acme', slug='acme')
        OrganizationMember.objects.create(organization=self.org, user=self.user)
        self.run = AgentRun.objects.create(organization=self.org, task='t')
        self.url = reverse('browser_agent:run-live', args=[self.run.id])

    def test_returns_latest_frame_once_per_seq(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(self.url).status_code, 204)
        cache.set(live_key(self.run.id), {
            'seq': 3, 'image': 'QUJD', 'url': 'https://x.example/', 'captured_at': '2026-10-21T20:00:00Z', 'live': True,
        })
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data['seq'], res.data['image']), (3, 'QUJD'))
        self.assertEqual(self.client.get(self.url, {'after': 3}).status_code, 204)

    def test_other_organizations_cannot_watch(self):
        outsider = make_user('outsider@example.com')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.url).status_code, 404)
