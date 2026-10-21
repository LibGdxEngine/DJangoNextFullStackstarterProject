import asyncio
from unittest.mock import MagicMock, patch

from asgiref.sync import async_to_sync, sync_to_async
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.organizations.models import Organization, OrganizationMember
from product.browser_agent import live as live_module
from product.browser_agent.live import (
    LiveScreencast, get_frame, get_state, live_key, push_input, release_control, request_control, state_key,
)
from product.browser_agent.models import AgentRun

from .test_api import make_user

FAST = patch.object(live_module, 'TICK_S', 0.01)


class FakeCDP:
    def __init__(self):
        self.handlers = {}
        self.sent = []

    def on(self, event, handler):
        self.handlers[event] = handler

    async def send(self, method, params=None):
        self.sent.append((method, params))

    async def detach(self):
        self.sent.append(('detach', None))

    def methods(self):
        return [method for method, _ in self.sent]


def fake_page(cdp, url):
    page = MagicMock()
    page.url = url

    async def new_cdp_session(target):
        return cdp
    page.context.new_cdp_session = new_cdp_session
    return page


def fake_session(cdp, url='https://a.example/'):
    session = MagicMock()
    session.page = fake_page(cdp, url)
    session.lock = asyncio.Lock()
    return session


async def wait_until(predicate, timeout=2.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not await sync_to_async(predicate)():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError('condition not reached')
        await asyncio.sleep(0.01)


class LiveScreencastTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_publishes_frames_and_follows_tab_switches(self):
        first, second = FakeCDP(), FakeCDP()
        session = fake_session(first)

        async def scenario():
            with FAST:
                live = LiveScreencast(session, 'run-1')
                live.start()
                await wait_until(lambda: 'Page.screencastFrame' in first.handlers)
                first.handlers['Page.screencastFrame']({'data': 'AAA', 'sessionId': 1})
                await wait_until(lambda: get_frame('run-1') is not None)
                frame_a = get_frame('run-1')

                session.page = fake_page(second, 'https://b.example/')
                await wait_until(lambda: 'Page.screencastFrame' in second.handlers)
                second.handlers['Page.screencastFrame']({'data': 'BBB', 'sessionId': 7})
                await wait_until(lambda: get_frame('run-1')['image'] == 'BBB')
                frame_b = get_frame('run-1')
                await live.stop()
                return frame_a, frame_b

        frame_a, frame_b = async_to_sync(scenario)()
        self.assertEqual((frame_a['image'], frame_a['url'], frame_a['live']), ('AAA', 'https://a.example/', True))
        self.assertEqual(frame_b['url'], 'https://b.example/')
        self.assertGreater(frame_b['seq'], frame_a['seq'])
        self.assertIn('Page.stopScreencast', first.methods())  # detached from the old tab
        self.assertIn('Page.screencastFrameAck', second.methods())
        self.assertFalse(get_frame('run-1')['live'])

    def test_attach_failure_does_not_raise(self):
        session = MagicMock()
        session.page.context.new_cdp_session.side_effect = RuntimeError('page closed')

        async def scenario():
            with FAST:
                live = LiveScreencast(session, 'run-2')
                live.start()
                await asyncio.sleep(0.05)
                await live.stop()

        async_to_sync(scenario)()
        self.assertIsNone(get_frame('run-2'))

    def test_user_takeover_pauses_the_agent_and_replays_input(self):
        cdp = FakeCDP()
        session = fake_session(cdp)

        async def scenario():
            with FAST:
                live = LiveScreencast(session, 'run-3')
                live.start()
                await wait_until(lambda: 'Page.screencastFrame' in cdp.handlers)
                cdp.handlers['Page.screencastFrame']({
                    'data': 'AAA', 'sessionId': 1, 'metadata': {'deviceWidth': 1000, 'deviceHeight': 500}})

                # The agent is mid-step: the takeover waits for it.
                await session.lock.acquire()
                await sync_to_async(request_control)('run-3', 'me@example.com')
                await wait_until(lambda: get_state('run-3')['control'] == 'waiting')
                session.lock.release()
                await wait_until(lambda: get_state('run-3')['control'] == 'user')
                self.assertTrue(session.lock.locked())  # the agent's next tool call blocks

                await sync_to_async(push_input)('run-3', [
                    {'type': 'click', 'x': 0.5, 'y': 0.2},
                    {'type': 'text', 'text': 'سلام'},
                    {'type': 'key', 'key': 'Enter'},
                ])
                await wait_until(lambda: 'Input.insertText' in cdp.methods()
                                 and cdp.methods().count('Input.dispatchKeyEvent') == 2)

                await sync_to_async(release_control)('run-3')
                await wait_until(lambda: get_state('run-3')['control'] == 'agent')
                self.assertFalse(session.lock.locked())
                await live.stop()

        async_to_sync(scenario)()
        pressed = [p for m, p in cdp.sent if m == 'Input.dispatchMouseEvent' and p['type'] == 'mousePressed']
        self.assertEqual((pressed[0]['x'], pressed[0]['y']), (500.0, 100.0))  # scaled to the viewport
        self.assertIn(('Input.insertText', {'text': 'سلام'}), cdp.sent)
        enter = next(p for m, p in cdp.sent if m == 'Input.dispatchKeyEvent' and p['type'] == 'keyDown')
        self.assertEqual((enter['key'], enter['text']), ('Enter', '\r'))

    def test_agent_handoff_waits_until_the_user_hands_back(self):
        cdp = FakeCDP()
        session = fake_session(cdp)

        async def scenario():
            with FAST:
                live = LiveScreencast(session, 'run-4')
                live.start()
                waiting = asyncio.create_task(live.wait_for_user('سجّل الدخول إلى Gmail', 5))
                await wait_until(lambda: get_state('run-4')['help'] == 'سجّل الدخول إلى Gmail')
                await sync_to_async(request_control)('run-4', 'me@example.com')
                await wait_until(lambda: get_state('run-4')['control'] == 'user')
                self.assertFalse(waiting.done())
                await sync_to_async(release_control)('run-4')
                outcome = await waiting
                await wait_until(lambda: get_state('run-4')['help'] == '')
                await live.stop()
                return outcome

        self.assertEqual(async_to_sync(scenario)(), 'returned')

    def test_handoff_times_out_without_a_user(self):
        session = fake_session(FakeCDP())

        async def scenario():
            with FAST:
                live = LiveScreencast(session, 'run-5')
                live.start()
                outcome = await live.wait_for_user('CAPTCHA', 0.05)
                await live.stop()
                return outcome

        self.assertEqual(async_to_sync(scenario)(), 'timeout')

    def test_quiet_viewer_loses_control(self):
        session = fake_session(FakeCDP())

        async def scenario():
            with FAST, patch.object(live_module, 'CONTROL_IDLE_TIMEOUT_S', 0.2):
                live = LiveScreencast(session, 'run-6')
                live.start()
                await sync_to_async(request_control)('run-6', 'me@example.com')
                await wait_until(lambda: get_state('run-6')['control'] == 'user')
                await wait_until(lambda: get_state('run-6')['control'] == 'agent')
                self.assertFalse(session.lock.locked())
                await live.stop()

        async_to_sync(scenario)()


class LiveEndpointTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('viewer@example.com')
        self.org = Organization.objects.create(name='Acme', slug='acme')
        OrganizationMember.objects.create(organization=self.org, user=self.user)
        self.run = AgentRun.objects.create(organization=self.org, task='t', status=AgentRun.Status.RUNNING)
        self.client.force_authenticate(self.user)

    def url(self, name):
        return reverse(f'browser_agent:run-{name}', args=[self.run.id])

    def test_returns_latest_frame_once_per_seq_with_state(self):
        empty = self.client.get(self.url('live'))
        self.assertEqual(empty.data, {'frame': None, 'state': {'control': 'agent', 'help': ''}})
        cache.set(live_key(self.run.id), {
            'seq': 3, 'image': 'QUJD', 'url': 'https://x.example/', 'captured_at': '2026-10-21T20:00:00Z', 'live': True,
        })
        cache.set(state_key(self.run.id), {'control': 'agent', 'help': 'سجّل الدخول'})
        res = self.client.get(self.url('live'))
        self.assertEqual((res.data['frame']['seq'], res.data['state']['help']), (3, 'سجّل الدخول'))
        self.assertIsNone(self.client.get(self.url('live'), {'after': 3}).data['frame'])

    def test_take_and_release_control(self):
        res = self.client.post(self.url('control'), {'action': 'take'}, format='json')
        self.assertEqual(res.status_code, 202)
        self.assertIsNotNone(cache.get(live_module.control_key(self.run.id)))
        self.client.post(self.url('control'), {'action': 'release'}, format='json')
        self.assertIsNone(cache.get(live_module.control_key(self.run.id)))

    def test_cannot_take_over_a_finished_run(self):
        self.run.status = AgentRun.Status.SUCCEEDED
        self.run.save()
        self.assertEqual(self.client.post(self.url('control'), {'action': 'take'}, format='json').status_code, 400)

    def test_input_requires_control_and_is_validated(self):
        events = {'events': [{'type': 'click', 'x': 0.1, 'y': 0.2}]}
        self.assertEqual(self.client.post(self.url('input'), events, format='json').status_code, 400)

        cache.set(state_key(self.run.id), {'control': 'user', 'help': ''})
        self.assertEqual(self.client.post(self.url('input'), events, format='json').status_code, 204)
        self.assertEqual(cache.get(live_module.input_key(self.run.id, 1))[0]['type'], 'click')

        for bad in ({'type': 'click', 'x': 2, 'y': 0}, {'type': 'key', 'key': 'F12'}, {'type': 'key', 'key': 'a'}):
            res = self.client.post(self.url('input'), {'events': [bad]}, format='json')
            self.assertEqual(res.status_code, 400, bad)

    def test_other_organizations_cannot_watch_or_drive(self):
        self.client.force_authenticate(make_user('outsider@example.com'))
        self.assertEqual(self.client.get(self.url('live')).status_code, 404)
        self.assertEqual(self.client.post(self.url('control'), {'action': 'take'}, format='json').status_code, 404)
