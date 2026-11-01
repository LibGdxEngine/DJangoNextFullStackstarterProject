"""PolicyGuard asks only for the action itself, once per kind of action per run."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from django.test import SimpleTestCase
from langchain_core.messages import ToolMessage

from product.browser_agent.engine.policy import Policy, PolicyGuard, action_label, classify

BACKGROUND = Policy(may_submit_forms=False, may_send_messages=False, may_post=False, may_upload=False)


class ActionLabelTests(SimpleTestCase):
    def test_short_commands_are_actions(self):
        for label in ('Post', 'Publish now', 'Share to feed', 'Send', 'Reply all', 'Place order'):
            self.assertEqual(action_label(label), label, label)

    def test_controls_around_the_action_are_not(self):
        for label in ('Post audience Public', 'Post settings', 'Send feedback', 'Share options',
                      'Post to a group, a page or a friend', 'Schedule for later', 'Sort by'):
            self.assertEqual(action_label(label), '', label)

    def test_classify_asks_for_the_post_button_but_not_the_audience_dropdown(self):
        self.assertIsNone(classify('click', {'element': '7'}, 'Post audience Public', 'button'))
        self.assertIsNone(classify('click', {'element': '7'}, 'Public', 'menuitem'))
        self.assertEqual(classify('click', {'element': '9'}, 'Post', 'button'), 'may_post')
        self.assertEqual(classify('click', {'element': '9'}, 'Publish now', 'button'), 'may_post')
        self.assertIsNone(classify('click', {'element': '3'}, 'Send feedback', 'link'))
        self.assertEqual(classify('click', {'element': '3'}, 'Send', 'button'), 'may_send_messages')


class StickyApprovalTests(SimpleTestCase):
    def _guard(self, answer):
        asked = []

        def ask_human(kind, question, options):
            asked.append(question)
            return answer

        guard = PolicyGuard(BACKGROUND, SimpleNamespace(element_descs={'9': ('button', 'Post')}, page=None),
                            ask_human=ask_human)
        return guard, asked

    def _click(self, guard, element):
        handler = AsyncMock(return_value=ToolMessage(content='clicked', tool_call_id='c', name='click'))
        request = SimpleNamespace(tool_call={'name': 'click', 'args': {'element': element}, 'id': 'c'},
                                  state={'messages': []})
        return asyncio.run(guard.awrap_tool_call(request, handler)).content

    def test_one_approval_covers_the_same_kind_of_action_for_the_run(self):
        guard, asked = self._guard('approve')
        self.assertEqual(self._click(guard, '9'), 'clicked')
        self.assertEqual(self._click(guard, '9'), 'clicked')   # the retry after a failed click
        self.assertEqual(len(asked), 1)
        self.assertIn('click button "Post"', asked[0])
        self.assertEqual(guard.granted, {'may_post'})

    def test_a_denial_is_asked_again_next_time(self):
        guard, asked = self._guard('deny')
        self.assertTrue(self._click(guard, '9').startswith('Not done'))
        self.assertTrue(self._click(guard, '9').startswith('Not done'))
        self.assertEqual(len(asked), 2)
        self.assertEqual(guard.granted, set())

    def test_the_audience_dropdown_is_never_asked_about(self):
        guard, asked = self._guard('deny')
        guard.session.element_descs['7'] = ('button', 'Post audience Public')
        self.assertEqual(self._click(guard, '7'), 'clicked')
        self.assertEqual(asked, [])
