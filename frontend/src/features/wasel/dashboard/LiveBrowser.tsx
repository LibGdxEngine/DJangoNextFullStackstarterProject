"use client";

import { useEffect, useState } from "react";
import { agentApi, type AgentLiveFrame } from "@/lib/api/agent";

const POLL_MS = 700;

/** Polls the newest frame of the run's browser while `active`; fetches the last one once after. */
export function useLiveFrame(runId: string, active: boolean) {
  const [frame, setFrame] = useState<AgentLiveFrame>();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSeq = -1;

    const tick = async () => {
      try {
        const next = await agentApi.liveFrame(runId, lastSeq);
        if (cancelled) return;
        if (next) {
          lastSeq = next.seq;
          setFrame(next);
        }
      } catch {
        // A missed frame is harmless; the next poll catches up.
      }
      if (!cancelled && active) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, active]);

  return frame;
}

export function LiveBrowser({ runId, active }: { runId: string; active: boolean }) {
  const frame = useLiveFrame(runId, active);
  const streaming = active && frame?.live !== false;

  return (
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
          style={{ color: streaming ? "#DC2626" : "#9A97AB" }}
        >
          {streaming ? "● مباشر" : "آخر لقطة"}
        </span>
      </div>
      <div className="relative aspect-[1366/900] bg-[#F2F0F8]">
        {frame ? (
          // A data: URL frame changes several times a second; next/image would only add overhead.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/jpeg;base64,${frame.image}`}
            alt="متصفح واصل الآن"
            className="absolute inset-0 h-full w-full object-contain object-top"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-soft">
            {active ? "يجري تشغيل المتصفح…" : "لا توجد لقطة لهذا الطلب."}
          </div>
        )}
      </div>
    </div>
  );
}
