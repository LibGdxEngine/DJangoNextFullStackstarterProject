"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentApi,
  type AgentControlState,
  type AgentInputEvent,
  type AgentLiveFrame,
} from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";

const POLL_MS = 700;
/** Faster polling while a person drives, so their clicks show up quickly. */
const DRIVING_POLL_MS = 250;
/** Re-claim control this often; the worker gives it back after two quiet minutes. */
const HEARTBEAT_MS = 30_000;

const IDLE_STATE: AgentControlState = { control: "agent", help: "" };

/** Keys forwarded as key presses; everything else printable is sent as text. */
const SPECIAL_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
]);

function modifierMask(e: React.KeyboardEvent): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

/** Polls who drives the run's browser and its newest frame; once more after the run ends. */
export function useLive(runId: string, active: boolean) {
  const [frame, setFrame] = useState<AgentLiveFrame>();
  const [state, setState] = useState<AgentControlState>(IDLE_STATE);
  const driving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSeq = -1;

    const tick = async () => {
      try {
        const live = await agentApi.live(runId, lastSeq);
        if (cancelled) return;
        if (live.frame) {
          lastSeq = live.frame.seq;
          setFrame(live.frame);
        }
        driving.current = live.state.control !== "agent";
        setState(live.state);
      } catch {
        // A missed poll is harmless; the next one catches up.
      }
      if (!cancelled && active) {
        timer = setTimeout(() => void tick(), driving.current ? DRIVING_POLL_MS : POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, active]);

  return { frame, state: active ? state : IDLE_STATE, setState };
}

/** Sends input in order, batching whatever piles up while a request is in flight. */
function useInputQueue(runId: string, onError: (message: string) => void) {
  const queue = useRef<AgentInputEvent[]>([]);
  const sending = useRef(false);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length > 0) {
        const batch = queue.current.splice(0, 100);
        try {
          await agentApi.sendInput(runId, batch);
        } catch (error) {
          onError(describeApiError(error).message);
        }
      }
    } finally {
      sending.current = false;
    }
  }, [runId, onError]);

  const push = useCallback(
    (event: AgentInputEvent) => {
      const last = queue.current[queue.current.length - 1];
      // Merge runs of typing and scrolling so a burst becomes one event.
      if (last?.type === "text" && event.type === "text") {
        last.text = `${last.text ?? ""}${event.text ?? ""}`;
      } else if (last?.type === "wheel" && event.type === "wheel") {
        last.dy = Math.max(-5000, Math.min(5000, (last.dy ?? 0) + (event.dy ?? 0)));
      } else {
        queue.current.push({ ...event });
      }
      void flush();
    },
    [flush],
  );

  return push;
}

export function LiveBrowser({
  runId,
  active,
  agentName,
}: {
  runId: string;
  active: boolean;
  agentName: string;
}) {
  const { frame, state, setState } = useLive(runId, active);
  const [error, setError] = useState<string>();
  const screenRef = useRef<HTMLDivElement>(null);
  const push = useInputQueue(runId, setError);
  const driving = state.control === "user";
  const streaming = active && frame?.live !== false;

  const control = useCallback(
    async (action: "take" | "release") => {
      setError(undefined);
      try {
        setState(await agentApi.control(runId, action));
      } catch (err) {
        setError(describeApiError(err).message);
      }
    },
    [runId, setState],
  );

  // Keep the claim alive while driving, and put the keyboard on the browser.
  useEffect(() => {
    if (!driving) return;
    screenRef.current?.focus();
    const timer = setInterval(() => void agentApi.control(runId, "take").catch(() => undefined), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [driving, runId]);

  function pointer(e: React.MouseEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const modifiers = modifierMask(e);
    const shortcut = (e.ctrlKey || e.metaKey) && e.key.length === 1;
    if (shortcut && e.key.toLowerCase() === "v") return; // the paste event carries the text
    if (shortcut && /^[a-z]$/i.test(e.key)) {
      push({ type: "key", key: e.key.toLowerCase(), modifiers });
    } else if (SPECIAL_KEYS.has(e.key)) {
      push({ type: "key", key: e.key, modifiers });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      push({ type: "text", text: e.key });
    } else {
      return;
    }
    e.preventDefault();
  }

  return (
    <div className="flex flex-col gap-3">
      {state.help && !driving ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-amber bg-[#FFF6E6] px-4 py-3 text-sm">
          <span>
            🙋 <b>{agentName} تحتاج مساعدتك:</b> {state.help}
          </span>
          {state.control === "agent" ? (
            <button
              onClick={() => void control("take")}
              className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet"
            >
              ✋ تولَّ المتصفح
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[22px] border border-line bg-white shadow-[0_20px_50px_rgba(14,11,31,.06)]">
        <div className="flex items-center gap-3 border-b border-line bg-[#FBFAFE] px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          </div>
          <div dir="ltr" className="min-w-0 flex-1 truncate rounded-full bg-white px-3 py-1 text-xs text-muted">
            {frame?.url || "about:blank"}
          </div>
          <span
            className="whitespace-nowrap text-xs font-semibold"
            style={{ color: driving ? "#6D3BF5" : streaming ? "#DC2626" : "#9A97AB" }}
          >
            {driving ? "✋ أنت تتحكم" : streaming ? "● مباشر" : "آخر لقطة"}
          </span>
        </div>

        <div
          ref={screenRef}
          tabIndex={driving ? 0 : -1}
          aria-label={driving ? "المتصفح: انقر واكتب للتحكم" : "المتصفح"}
          onClick={driving ? (e) => push({ type: "click", ...pointer(e), count: Math.min(3, Math.max(1, e.detail)) }) : undefined}
          onWheel={driving ? (e) => push({ type: "wheel", ...pointer(e), dy: e.deltaY }) : undefined}
          onKeyDown={driving ? handleKeyDown : undefined}
          onPaste={
            driving
              ? (e) => {
                  const text = e.clipboardData.getData("text").slice(0, 2000);
                  if (text) push({ type: "text", text });
                  e.preventDefault();
                }
              : undefined
          }
          className={`relative select-none bg-[#F2F0F8] outline-none ${
            driving ? "cursor-pointer ring-4 ring-violet/60 ring-inset" : ""
          }`}
        >
          {frame ? (
            // A data: URL frame changes several times a second; next/image would only add overhead.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/jpeg;base64,${frame.image}`}
              alt="متصفح واصل الآن"
              draggable={false}
              className="pointer-events-none block h-auto w-full"
            />
          ) : (
            <div className="flex aspect-[1366/900] items-center justify-center text-sm text-muted-soft">
              {active ? "يجري تشغيل المتصفح…" : "لا توجد لقطة لهذا الطلب."}
            </div>
          )}
        </div>

        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px]">
            {state.control === "agent" ? (
              <>
                <span className="text-muted">{agentName} تتحكم في المتصفح.</span>
                <button
                  onClick={() => void control("take")}
                  className="whitespace-nowrap rounded-full border border-line px-3.5 py-1.5 hover:border-violet hover:text-violet"
                >
                  ✋ تحكّم بنفسك
                </button>
              </>
            ) : state.control === "waiting" ? (
              <>
                <span className="text-muted">⏳ بانتظار أن تُنهي {agentName} خطوتها الحالية…</span>
                <button
                  onClick={() => void control("release")}
                  className="whitespace-nowrap rounded-full border border-line px-3.5 py-1.5"
                >
                  إلغاء
                </button>
              </>
            ) : (
              <>
                <span className="text-muted">انقر واكتب داخل المتصفح. {agentName} متوقفة حتى تسلّمها.</span>
                <button
                  onClick={() => void control("release")}
                  className="whitespace-nowrap rounded-full bg-violet px-3.5 py-1.5 font-semibold text-white hover:bg-violet-dark"
                >
                  سلّم المتصفح لـ{agentName} ←
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-xl bg-[#FEE2E2] px-4 py-2.5 text-sm text-[#B91C1C]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
