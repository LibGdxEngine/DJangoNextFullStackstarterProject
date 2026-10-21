import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from asgiref.sync import async_to_sync
from django.test import TransactionTestCase, override_settings
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from apps.organizations.models import Organization
from product.browser_agent.models import AgentRun, BrowserProfile
from product.browser_agent.services import execute_run


class FakeAgent:
    """Stands in for the deepagents graph: streams a tool call, its result, then an answer."""

    def __init__(self, workspace=None, fail=False):
        self.workspace = workspace
        self.fail = fail

    async def astream(self, payload, config=None, stream_mode=None):
        task = HumanMessage(content=payload['messages'][0]['content'], id='h1')
        call = AIMessage(content='', id='a1', tool_calls=[{'name': 'browse', 'args': {'url': 'x'}, 'id': 'c1'}])
        yield {'messages': [task, call]}
        if self.fail:
            raise RuntimeError('model exploded')
        yield {'messages': [task, call, ToolMessage(content='page text', name='browse', tool_call_id='c1', id='t1')]}
        if self.workspace:
            (Path(self.workspace) / 'report.txt').write_text('done')
        yield {'messages': [task, call, ToolMessage(content='page text', name='browse', tool_call_id='c1', id='t1'),
                            AIMessage(content='All done', id='a2')]}


def fake_session():
    session = MagicMock()
    session.start = AsyncMock()
    session.stop = AsyncMock()
    session.verify_ip = AsyncMock(return_value='1.2.3.4')
    return session


class ExecuteRunTests(TransactionTestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Acme', slug='acme')
        self.run = AgentRun.objects.create(organization=self.org, task='find the answer')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        override = override_settings(AGENT_RUNS_ROOT=Path(self.tmp.name), AGENT_PROFILES_ROOT=Path(self.tmp.name))
        override.enable()
        self.addCleanup(override.disable)

    def _execute(self, agent_factory, session=None):
        session = session or fake_session()
        engine = 'product.browser_agent.engine'
        with patch(f'{engine}.browser_tools.BrowserSession.from_env', return_value=session), \
                patch(f'{engine}.browser_tools.make_browser_tools', return_value=[]), \
                patch(f'{engine}.agent.build_agent',
                      side_effect=lambda s, tools, workspace, **kw: agent_factory(workspace)):
            async_to_sync(execute_run)(self.run.id)
        self.run.refresh_from_db()
        return session

    def test_successful_run_records_events_artifacts_and_result(self):
        session = self._execute(lambda ws: FakeAgent(ws))
        self.assertEqual(self.run.status, AgentRun.Status.SUCCEEDED)
        self.assertEqual(self.run.final_text, 'All done')
        kinds = list(self.run.events.values_list('kind', flat=True))
        self.assertEqual(kinds, ['tool_call', 'tool_result', 'message'])
        self.assertEqual(list(self.run.artifacts.values_list('path', flat=True)), ['workspace/report.txt'])
        session.stop.assert_awaited_once()
        self.assertIsNotNone(self.run.finished_at)

    def test_agent_failure_is_recorded_and_browser_closed(self):
        session = self._execute(lambda ws: FakeAgent(ws, fail=True))
        self.assertEqual(self.run.status, AgentRun.Status.FAILED)
        self.assertIn('model exploded', self.run.error)
        session.stop.assert_awaited_once()

    def test_cancel_request_stops_run(self):
        AgentRun.objects.filter(pk=self.run.pk).update(cancel_requested=True)
        # Cancelled before it starts: never launches a browser.
        session = self._execute(lambda ws: FakeAgent(ws))
        self.assertEqual(self.run.status, AgentRun.Status.CANCELLED)
        session.start.assert_not_awaited()

    def test_timeout(self):
        class Hang(FakeAgent):
            async def astream(self, *args, **kwargs):
                await asyncio.sleep(5)
                yield {}

        with override_settings(AGENT_RUN_TIMEOUT=0.05):
            self._execute(lambda ws: Hang(ws))
        self.assertEqual(self.run.status, AgentRun.Status.TIMEOUT)

    def test_busy_profile_fails_run_without_starting_browser(self):
        profile = BrowserProfile.objects.create(organization=self.org, name='p', in_use=True)
        self.run.profile = profile
        self.run.save()
        session = self._execute(lambda ws: FakeAgent(ws))
        self.assertEqual(self.run.status, AgentRun.Status.FAILED)
        session.start.assert_not_awaited()
        profile.refresh_from_db()
        # The other run still owns the profile; this run must not release it.
        self.assertTrue(profile.in_use)

    def test_profile_released_after_run(self):
        profile = BrowserProfile.objects.create(organization=self.org, name='p')
        self.run.profile = profile
        self.run.save()
        session = self._execute(lambda ws: FakeAgent(ws))
        self.assertEqual(self.run.status, AgentRun.Status.SUCCEEDED)
        self.assertEqual(session.profile_dir, str(profile.directory))
        profile.refresh_from_db()
        self.assertFalse(profile.in_use)
