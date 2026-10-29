"""Live view and user takeover of a run's browser.

The worker owns the browser and the API process serves viewers, so everything travels
through the shared (Redis) cache:

* ``agent_live:<run>``     newest screencast frame (JPEG, base64) and its sequence number;
* ``agent_control:<run>``  the viewer's request to drive the browser, with a heartbeat;
* ``agent_state:<run>``    what the worker reports back: who drives, and why help is wanted;
* ``agent_input:<run>:n``  batches of viewer input, numbered by ``agent_input_head:<run>``.

While a person drives, the worker holds ``session.lock``. Every agent tool takes that
lock, so the agent finishes its current step and then waits until control is handed back.
"""
import asyncio
import logging
import time

from asgiref.sync import sync_to_async
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

TICK_S = 0.1
FRAME_TTL_S = 15 * 60
STATE_TTL_S = 15 * 60
INPUT_TTL_S = 120
# Control returns to the agent when the viewer goes quiet for this long.
CONTROL_IDLE_TIMEOUT_S = 120
# How long a published input batch number may stay unreadable before it is skipped.
MISSING_INPUT_GRACE_S = 2.0

SCREENCAST_PARAMS = {'format': 'jpeg', 'quality': 60, 'maxWidth': 1280, 'maxHeight': 900, 'everyNthFrame': 1}

# Control states reported to viewers.
AGENT, WAITING, USER = 'agent', 'waiting', 'user'

# Special keys the viewer may send: key -> (code, windowsVirtualKeyCode, text typed on keyDown).
SPECIAL_KEYS = {
    'Enter': ('Enter', 13, '\r'), 'Backspace': ('Backspace', 8, ''), 'Tab': ('Tab', 9, ''),
    'Escape': ('Escape', 27, ''), 'Delete': ('Delete', 46, ''), 'Home': ('Home', 36, ''),
    'End': ('End', 35, ''), 'PageUp': ('PageUp', 33, ''), 'PageDown': ('PageDown', 34, ''),
    'ArrowLeft': ('ArrowLeft', 37, ''), 'ArrowUp': ('ArrowUp', 38, ''),
    'ArrowRight': ('ArrowRight', 39, ''), 'ArrowDown': ('ArrowDown', 40, ''),
}


def live_key(run_id) -> str:
    return f'agent_live:{run_id}'


def control_key(run_id) -> str:
    return f'agent_control:{run_id}'


def state_key(run_id) -> str:
    return f'agent_state:{run_id}'


def input_head_key(run_id) -> str:
    return f'agent_input_head:{run_id}'


def input_key(run_id, n: int) -> str:
    return f'agent_input:{run_id}:{n}'


def get_frame(run_id) -> dict | None:
    return cache.get(live_key(run_id))


def get_state(run_id) -> dict:
    return cache.get(state_key(run_id)) or {'control': AGENT, 'help': ''}


# --- API side -------------------------------------------------------------------------

def request_control(run_id, user_label: str) -> None:
    """Ask the worker to hand the browser to a viewer (also refreshes the heartbeat)."""
    cache.set(control_key(run_id), {'by': user_label, 'heartbeat': time.time()}, STATE_TTL_S)


def release_control(run_id) -> None:
    cache.delete(control_key(run_id))


def push_input(run_id, events: list[dict]) -> None:
    """Queue a batch of viewer input for the worker, in order."""
    head = input_head_key(run_id)
    cache.add(head, 0, STATE_TTL_S)
    n = cache.incr(head)
    cache.set(input_key(run_id, n), events, INPUT_TTL_S)
    # Typing counts as activity, so an active viewer never times out.
    control = cache.get(control_key(run_id))
    if control:
        request_control(run_id, control.get('by', ''))


# --- Worker side ----------------------------------------------------------------------

class LiveScreencast:
    """Publishes the screencast of ``session.page`` (following tab switches), and lets a
    viewer take the browser over. Failures cost the live view, never the run."""

    def __init__(self, session, run_id):
        self.session = session
        self.run_id = run_id
        self._page = None
        self._cdp = None
        self._frame: str | None = None
        self._frame_seq = 0
        self._published_seq = 0
        self._viewport = (1366, 900)
        self._task: asyncio.Task | None = None
        self._lock_task: asyncio.Task | None = None
        self._control = AGENT
        self._help = ''
        self._published_state: tuple | None = None
        self._next_input = 1
        self._missing_since: float | None = None
        self._handed_back = asyncio.Event()

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        for task in (self._task, self._lock_task):
            if task:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        self._give_back_lock()
        self._help = ''
        await self._detach()
        await self._publish_frame(live=False)
        await sync_to_async(cache.set)(state_key(self.run_id), {'control': AGENT, 'help': ''}, STATE_TTL_S)
        await sync_to_async(cache.delete)(control_key(self.run_id))

    # The agent's side of a handoff ------------------------------------------------------

    async def wait_for_user(self, reason: str, timeout_s: float) -> str:
        """Ask the viewer to take over and wait until they hand the browser back."""
        self._help = reason
        self._handed_back.clear()
        try:
            await asyncio.wait_for(self._handed_back.wait(), timeout_s)
            return 'returned'
        except asyncio.TimeoutError:
            return 'timeout'
        finally:
            self._help = ''

    # Loop -------------------------------------------------------------------------------

    async def _loop(self) -> None:
        while True:
            try:
                page = self.session.page
                if page is not None and page is not self._page:
                    await self._attach(page)
                await self._sync_control()
                if self._control == USER:
                    await self._drain_input()
                if self._frame_seq != self._published_seq:
                    await self._publish_frame(live=True)
                await self._publish_state()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.debug('Live view update for run %s failed', self.run_id, exc_info=True)
            await asyncio.sleep(TICK_S)

    async def _sync_control(self) -> None:
        request = await sync_to_async(cache.get)(control_key(self.run_id))
        wanted = bool(request) and time.time() - request.get('heartbeat', 0) < CONTROL_IDLE_TIMEOUT_S
        if wanted and self._control == AGENT:
            self._control = WAITING
            self._lock_task = asyncio.create_task(self._take_lock())
        elif not wanted and self._control != AGENT:
            if self._lock_task and not self._lock_task.done():
                self._lock_task.cancel()
            self._give_back_lock()
            if request:  # timed out rather than released
                await sync_to_async(cache.delete)(control_key(self.run_id))

    async def _take_lock(self) -> None:
        # Waits for the agent to finish the step it is in.
        await self.session.lock.acquire()
        self._control = USER
        # Ignore input sent before control was granted.
        head = await sync_to_async(cache.get)(input_head_key(self.run_id))
        self._next_input = (head or 0) + 1

    def _give_back_lock(self) -> None:
        was_user = self._control == USER
        if was_user and self.session.lock.locked():
            self.session.lock.release()
        self._control = AGENT
        self._lock_task = None
        if was_user:
            self._handed_back.set()

    async def _drain_input(self) -> None:
        head = await sync_to_async(cache.get)(input_head_key(self.run_id)) or 0
        while self._next_input <= head:
            key = input_key(self.run_id, self._next_input)
            events = await sync_to_async(cache.get)(key)
            if events is None:
                # Numbered but not stored yet; give the API a moment, then skip it.
                self._missing_since = self._missing_since or time.monotonic()
                if time.monotonic() - self._missing_since < MISSING_INPUT_GRACE_S:
                    return
            else:
                await sync_to_async(cache.delete)(key)
                for event in events:
                    try:
                        await self._dispatch(event)
                    except Exception as exc:
                        # Never log the event itself: it may hold a password the user typed.
                        logger.warning('Replaying %s input for run %s failed: %s: %s',
                                       event.get('type'), self.run_id, type(exc).__name__, exc)
            self._missing_since = None
            self._next_input += 1

    async def _dispatch(self, event: dict) -> None:
        cdp = self._cdp
        if cdp is None:
            return
        kind = event.get('type')
        width, height = self._viewport
        if kind in ('click', 'wheel', 'move'):
            x, y = float(event['x']) * width, float(event['y']) * height
            if kind == 'wheel':
                await cdp.send('Input.dispatchMouseEvent', {
                    'type': 'mouseWheel', 'x': x, 'y': y, 'deltaX': 0, 'deltaY': float(event.get('dy', 0)),
                })
                return
            await cdp.send('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
            if kind == 'click':
                common = {'x': x, 'y': y, 'button': 'left', 'clickCount': int(event.get('count', 1))}
                await cdp.send('Input.dispatchMouseEvent', {'type': 'mousePressed', **common})
                await cdp.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', **common})
        elif kind == 'text':
            await cdp.send('Input.insertText', {'text': str(event['text'])})
        elif kind == 'key':
            key = str(event['key'])
            modifiers = int(event.get('modifiers', 0))
            if key in SPECIAL_KEYS:
                code, vk, text = SPECIAL_KEYS[key]
            else:  # a shortcut such as Ctrl+A
                code, vk, text = f'Key{key.upper()}', ord(key.upper()), ''
            down = {'type': 'keyDown', 'key': key, 'code': code, 'windowsVirtualKeyCode': vk,
                    'modifiers': modifiers}
            if text and not modifiers:
                down['text'] = text
            await cdp.send('Input.dispatchKeyEvent', down)
            await cdp.send('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': key, 'code': code,
                                                      'windowsVirtualKeyCode': vk, 'modifiers': modifiers})

    # Screencast -------------------------------------------------------------------------

    async def _attach(self, page) -> None:
        await self._detach()
        self._page = page
        cdp = await page.context.new_cdp_session(page)
        cdp.on('Page.screencastFrame', self._on_frame)
        await cdp.send('Page.startScreencast', SCREENCAST_PARAMS)
        self._cdp = cdp

    async def _detach(self) -> None:
        cdp, self._cdp = self._cdp, None
        if cdp is None:
            return
        try:
            await cdp.send('Page.stopScreencast')
            await cdp.detach()
        except Exception:
            pass  # the page may already be closed

    def _on_frame(self, params: dict) -> None:
        self._frame = params.get('data')
        self._frame_seq += 1
        metadata = params.get('metadata') or {}
        if metadata.get('deviceWidth') and metadata.get('deviceHeight'):
            self._viewport = (float(metadata['deviceWidth']), float(metadata['deviceHeight']))
        cdp = self._cdp
        if cdp is not None and 'sessionId' in params:
            # Chrome sends the next frame only after this one is acknowledged.
            asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': params['sessionId']}))

    async def _publish_frame(self, *, live: bool) -> None:
        if self._frame is None:
            return
        self._published_seq = self._frame_seq
        url = ''
        try:
            url = self.session.page.url if self.session.page else ''
        except Exception:
            pass
        frame = {
            'seq': self._frame_seq,
            'image': self._frame,
            'url': url,
            'captured_at': timezone.now().isoformat(),
            'live': live,
        }
        await sync_to_async(cache.set)(live_key(self.run_id), frame, FRAME_TTL_S)

    async def _publish_state(self) -> None:
        state = (self._control, self._help)
        if state == self._published_state:
            return
        self._published_state = state
        await sync_to_async(cache.set)(
            state_key(self.run_id), {'control': self._control, 'help': self._help}, STATE_TTL_S)
