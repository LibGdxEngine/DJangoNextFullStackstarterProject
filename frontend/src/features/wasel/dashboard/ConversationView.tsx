"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { agents } from "@/features/wasel/data";
import { isTerminal, type AgentRunEvent } from "@/lib/api/agent";
import { LiveBrowser } from "./LiveBrowser";
import { runStatusLabel } from "./run-format";
import { useRun } from "./useRun";

const agent = agents[0];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function describeCall(payload: unknown): string {
  const { name, args } = asRecord(payload);
  const first = Object.values(asRecord(args))[0];
  const detail = typeof first === "string" ? first : "";
  return `${String(name ?? "")}${detail ? ` — ${detail.slice(0, 80)}` : ""}`;
}

function EventRow({ event }: { event: AgentRunEvent }) {
  const payload = asRecord(event.payload);
  if (event.kind === "message") {
    return <div className="text-base leading-loose whitespace-pre-wrap">{String(payload.text ?? "")}</div>;
  }
  if (event.kind === "tool_call") {
    return (
      <div className="flex items-start gap-3">
        <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-violet-tint text-xs text-violet">
          ⚙
        </span>
        <span dir="auto" className="text-[15px] leading-relaxed">{describeCall(event.payload)}</span>
      </div>
    );
  }
  return (
    <div dir="auto" className="ms-[38px] line-clamp-2 text-xs leading-relaxed text-muted-soft">
      {String(payload.content ?? "")}
    </div>
  );
}

export function ConversationView({ runId }: { runId: string }) {
  const { run, events, artifacts, error, notFound, cancel } = useRun(runId);
  const [showBrowser, setShowBrowser] = useState(true);

  if (notFound) {
    return (
      <div className="mx-auto max-w-[900px] px-8 py-24 text-center">
        <div className="text-xl font-bold">لم نجد هذه المحادثة</div>
        <Link href="/dashboard" className="mt-4 inline-block text-violet">
          ← طلب جديد
        </Link>
      </div>
    );
  }

  const status = run ? runStatusLabel(run.status) : undefined;
  const active = run ? !isTerminal(run.status) : true;
  const stepCount = events.filter((e) => e.kind === "tool_call").length;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-white px-6 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Image src={agent.img} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
          <div>
            <div className="text-[17px] font-bold">
              {agent.name} · {agent.role}
            </div>
            <div className="text-xs" style={{ color: status?.color ?? "#9A97AB" }}>
              {status?.text ?? "جارٍ التحميل…"}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowBrowser((shown) => !shown)}
            aria-pressed={showBrowser}
            className="whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px]"
            style={{
              borderColor: showBrowser ? "#6D3BF5" : "#E7E4F0",
              color: showBrowser ? "#6D3BF5" : undefined,
            }}
          >
            🖥 شاهد المتصفح
          </button>
          {active && run ? (
            <button
              onClick={() => void cancel()}
              disabled={run.cancel_requested}
              className="whitespace-nowrap rounded-full border border-line px-3.5 py-1.5 text-[13px] hover:border-[#B91C1C] hover:text-[#B91C1C] disabled:opacity-50"
            >
              {run.cancel_requested ? "جارٍ الإلغاء…" : "■ إيقاف"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col gap-[22px] px-6 py-8 md:px-8">
            {run ? (
              <div
                dir="auto"
                className="max-w-[70%] self-start rounded-[22px] rounded-br-md bg-violet px-5 py-3.5 text-base leading-relaxed whitespace-pre-wrap text-white"
              >
                {run.task}
              </div>
            ) : null}

            <div className="flex items-start gap-3">
              <Image src={agent.img} alt="" width={34} height={34} className="h-[34px] w-[34px] flex-shrink-0 rounded-full object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-3.5">
                {events.map((event) => (
                  <EventRow key={event.seq} event={event} />
                ))}

                {active ? (
                  <div className="flex flex-col gap-2.5 rounded-[20px] bg-ink p-5 text-sm text-white">
                    <div className="flex justify-between">
                      <span className="text-amber">
                        ● {run?.status === "queued" ? "في الانتظار…" : `${agent.name} تعمل الآن`}
                      </span>
                      <span className="text-[#C9C4DE]">{stepCount.toLocaleString("ar-EG")} خطوة</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-1/3 animate-pulse bg-amber" />
                    </div>
                  </div>
                ) : null}

                {run && !active ? (
                  <div className="rounded-3xl border border-line bg-white p-6">
                    <div className="text-xs text-muted-soft">النتيجة</div>
                    {run.final_text ? (
                      <div dir="auto" className="mt-2 text-base leading-loose whitespace-pre-wrap">
                        {run.final_text}
                      </div>
                    ) : null}
                    {run.error ? (
                      <div role="alert" className="mt-3 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">
                        {run.error}
                      </div>
                    ) : null}
                    {artifacts.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {artifacts.map((artifact) => (
                          <span key={artifact.id} dir="ltr" className="rounded-full bg-[#F2F0F8] px-3 py-1.5 text-xs">
                            {artifact.kind === "screenshot" ? "🖼" : "📄"} {artifact.path.split("/").pop()}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {error ? (
                  <div role="alert" className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[900px] px-6 pb-7 md:px-8">
            <Link
              href="/dashboard"
              className="flex items-center justify-center gap-2 rounded-[22px] border border-line bg-white p-3.5 text-[15px] text-violet hover:border-[#B9A3FF]"
            >
              ＋ طلب جديد
            </Link>
          </div>
        </div>

        {showBrowser ? (
          <aside className="order-first border-b border-line p-6 xl:sticky xl:top-0 xl:order-none xl:h-screen xl:w-[46%] xl:flex-shrink-0 xl:border-r xl:border-b-0">
            <LiveBrowser runId={runId} active={active} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
