"""Live view of a run's browser: a CDP screencast whose latest frame is kept in the cache.

The worker owns the browser, the API process serves viewers, so frames travel through
the shared (Redis) cache: one key per run holding the newest JPEG and a sequence number.
"""
import asyncio
import logging

from asgiref.sync import sync_to_async
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

# How often new frames are published, and how long the last one outlives the run.
PUBLISH_INTERVAL_S = 0.25
FRAME_TTL_S = 15 * 60

SCREENCAST_PARAMS = {'format': 'jpeg', 'quality': 60, 'maxWidth': 1280, 'maxHeight': 900, 'everyNthFrame': 1}


def live_key(run_id) -> str:
    return f'agent_live:{run_id}'


def get_frame(run_id) -> dict | None:
    return cache.get(live_key(run_id))


class LiveScreencast:
    """Follows ``session.page`` (it changes when the agent adopts a new tab) and publishes
    its screencast frames. Failures only cost the live view, never the run."""

    def __init__(self, session, run_id):
        self.session = session
        self.run_id = run_id
        self._page = None
        self._cdp = None
        self._frame: str | None = None
        self._frame_seq = 0
        self._published_seq = 0
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        await self._detach()
        await self._publish(live=False)

    async def _loop(self) -> None:
        while True:
            try:
                page = self.session.page
                if page is not None and page is not self._page:
                    await self._attach(page)
                if self._frame_seq != self._published_seq:
                    await self._publish(live=True)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.debug('Live view update for run %s failed', self.run_id, exc_info=True)
            await asyncio.sleep(PUBLISH_INTERVAL_S)

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
        cdp = self._cdp
        if cdp is not None and 'sessionId' in params:
            # Chrome sends the next frame only after this one is acknowledged.
            asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': params['sessionId']}))

    async def _publish(self, *, live: bool) -> None:
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
