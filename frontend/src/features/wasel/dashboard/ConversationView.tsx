"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { isTerminal } from "@/lib/api/agent";
import { ArtifactList } from "./ArtifactList";
import { asRecord, fileNotes, formatDuration, groupSteps, progressOf, type Step, type Todo } from "./describe-step";
import { LiveBrowser } from "./LiveBrowser";
import { runStatusLabel } from "./run-format";
import { DEFAULT_ROLE } from "./useCatalog";
import { useResizablePanel } from "./useResizablePanel";
import { useRun } from "./useRun";

/** Tools with which the agent asks the user to take over the browser. */
const HANDOFF_TOOLS = new Set(["hand_over_to_user", "manual_captcha_handoff"]);

const arabic = (n: number): string => n.toLocaleString("ar-EG");

/** One tool call and what came of it: a plain sentence, a verdict, and the raw text on demand. */
function StepRow({ step }: { step: Extract<Step, { kind: "step" }> }) {
  if (HANDOFF_TOOLS.has(step.name)) {
    const reason = asRecord(step.args).reason;
    return (
      <div className="flex items-start gap-3 rounded-[16px] bg-[#FFF6E6] px-3 py-2.5">
        <span className="text-base">🙋</span>
        <span dir="auto" className="text-[15px] leading-relaxed">
          طلبت مساعدتك في المتصفح{typeof reason === "string" && reason ? `: ${reason}` : "."}
        </span>
      </div>
    );
  }
  const { result } = step;
  const mark = !result ? "…" : result.ok ? "✓" : "✕";
  const markClass = !result
    ? "bg-amber/20 text-[#B45309] animate-pulse"
    : result.ok
      ? "bg-success-tint text-success"
      : "bg-[#FEE2E2] text-[#B91C1C]";
  return (
    <details className="group rounded-[14px] px-2 py-1.5 open:bg-paper">
      <summary className="flex cursor-pointer list-none items-start gap-3">
        <span className={`mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${markClass}`} aria-label={!result ? "جارٍ" : result.ok ? "نجحت" : "تعذّرت"}>
          {mark}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="text-[15px] leading-relaxed">
            <span aria-hidden className="me-1.5">{step.call.icon}</span>
            {step.call.text}
            {step.call.file ? <span className="text-muted"> ويحفظها في {step.call.file}</span> : null}
          </span>
          {result ? (
            <span dir="auto" className={`text-[13px] leading-relaxed ${result.ok ? "text-muted" : "text-[#B91C1C]"}`}>
              {result.text}
              {step.seconds !== undefined && step.seconds >= 1 ? <span className="text-muted-soft"> · {arabic(Math.round(step.seconds))} ث</span> : null}
            </span>
          ) : (
            <span className="text-[13px] text-muted-soft">جارٍ التنفيذ…</span>
          )}
        </span>
        <span aria-hidden className="mt-1 text-xs text-muted-soft transition-transform group-open:rotate-90">▸</span>
      </summary>
      <div dir="ltr" className="ms-[34px] mt-2 overflow-x-auto rounded-xl bg-white p-3 text-start font-mono text-[11px] leading-relaxed text-muted">
        <div className="text-ink">{step.name}({JSON.stringify(step.args).slice(0, 600)})</div>
        {step.raw ? <pre className="mt-2 whitespace-pre-wrap break-words">{step.raw.slice(0, 1500)}</pre> : null}
      </div>
    </details>
  );
}

function PlanList({ todos }: { todos: Todo[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {todos.map((todo, i) => (
        <li key={`${i}-${todo.content}`} dir="auto" className="flex items-start gap-2 text-sm leading-relaxed">
          <span aria-hidden className="mt-0.5 text-xs">
            {todo.status === "completed" ? "✅" : todo.status === "in_progress" ? "🔄" : "⬜"}
          </span>
          <span className={todo.status === "completed" ? "text-muted line-through" : todo.status === "in_progress" ? "font-medium" : "text-muted"}>
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ticks once a second so the elapsed time on the progress card moves. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The question a waiting run asked, with its choices and a free-text reply. */
function QuestionCard({ question, onAnswer }: { question: unknown; onAnswer: (reply: string) => Promise<void> }) {
  const { question: text, options } = asRecord(question);
  const choices = Array.isArray(options) ? options.map(String) : [];
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (value: string) => {
    if (!value.trim() || sending) return;
    setSending(true);
    try {
      await onAnswer(value.trim());
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-[#F5C77A] bg-[#FFF6E6] p-5">
      <div className="text-xs text-[#B45309]">⏸ ينتظر ردّك</div>
      <div dir="auto" className="text-base leading-relaxed">{String(text ?? "")}</div>
      {choices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              key={choice}
              onClick={() => void send(choice)}
              disabled={sending}
              className="rounded-full border border-violet bg-white px-4 py-1.5 text-sm text-violet hover:bg-violet hover:text-white disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(reply);
        }}
        className="flex gap-2"
      >
        <input
          dir="auto"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="اكتب ردّك…"
          maxLength={4000}
          className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2 text-sm outline-none focus:border-violet"
        />
        <button
          type="submit"
          disabled={sending || !reply.trim()}
          className="rounded-full bg-violet px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          إرسال
        </button>
      </form>
    </div>
  );
}

export function ConversationView({ runId }: { runId: string }) {
  const { run, events, artifacts, error, notFound, cancel, answer } = useRun(runId);
  const [showBrowser, setShowBrowser] = useState(true);
  const { containerRef: panelRef, pct: panelPct, dragging, handleProps } = useResizablePanel();
  const steps = useMemo(() => groupSteps(events), [events]);
  const progress = useMemo(() => progressOf(steps), [steps]);
  const notes = useMemo(() => fileNotes(events), [events]);
  const active = run ? !isTerminal(run.status) : true;
  const now = useNow(active && run?.status === "running");

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

  const agent = run?.role_detail ?? DEFAULT_ROLE;
  const status = run ? runStatusLabel(run.status) : undefined;
  // The agent asked for the user (a login or CAPTCHA): the browser must be on screen.
  const lastStep = steps[steps.length - 1];
  const awaitingUser = active && lastStep?.kind === "step" && HANDOFF_TOOLS.has(lastStep.name) && !lastStep.result;
  const browserVisible = showBrowser || awaitingUser;
  const started = run?.started_at ? new Date(run.started_at).getTime() : undefined;
  const finished = run?.finished_at ? new Date(run.finished_at).getTime() : undefined;
  const elapsed = started ? formatDuration((finished ?? now) - started) : undefined;
  // The latest plan sits on the progress card; earlier versions of it are history.
  const lastPlanSeq = [...steps].reverse().find((s) => s.kind === "plan")?.seq;
  const summaryBits = [`${arabic(progress.total)} خطوة`];
  if (progress.failed) summaryBits.push(`${arabic(progress.failed)} تعذّرت`);
  if (elapsed) summaryBits.push(elapsed);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-white px-6 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Image src={agent.avatar} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
          <div>
            <div className="text-[17px] font-bold">
              {agent.name} · {agent.title}
            </div>
            <div className="text-xs" style={{ color: status?.color ?? "#9A97AB" }}>
              {status?.text ?? "جارٍ التحميل…"}
              {run && progress.total ? <span className="text-muted-soft"> · {summaryBits.join(" · ")}</span> : null}
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

      <div
        ref={panelRef}
        style={{ "--browser-w": `${panelPct}%` } as React.CSSProperties}
        className={`flex flex-1 flex-col xl:flex-row ${dragging ? "cursor-col-resize select-none" : ""}`}
      >
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
              <Image src={agent.avatar} alt="" width={34} height={34} className="h-[34px] w-[34px] flex-shrink-0 rounded-full object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {steps.map((step) => {
                  if (step.kind === "step") return <StepRow key={step.seq} step={step} />;
                  if (step.kind === "message") {
                    return (
                      <div key={step.seq} dir="auto" className="my-1.5 text-base leading-loose whitespace-pre-wrap">
                        {step.text}
                      </div>
                    );
                  }
                  if (step.kind === "plan") {
                    if (step.seq === lastPlanSeq && active) return null;
                    return (
                      <details key={step.seq} className="rounded-[14px] px-2 py-1.5">
                        <summary className="cursor-pointer list-none text-[15px]">
                          <span aria-hidden className="me-1.5">🗒️</span>
                          {step.seq === lastPlanSeq ? "خطة العمل" : "حدّث خطة العمل"}
                        </summary>
                        <div className="ms-[30px] mt-2"><PlanList todos={step.todos} /></div>
                      </details>
                    );
                  }
                  if (step.kind === "question") {
                    return (
                      <div key={step.seq} className="flex items-start gap-3 rounded-[16px] bg-[#FFF6E6] px-3 py-2.5">
                        <span className="text-base">❓</span>
                        <span dir="auto" className="text-[15px] leading-relaxed">{step.text}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={step.seq} dir="auto" className="self-start rounded-[16px] bg-violet-tint px-3 py-2 text-[15px] text-violet">
                      ردّك: {step.text}
                    </div>
                  );
                })}

                {run?.status === "waiting" && run.question ? (
                  <QuestionCard question={run.question} onAnswer={answer} />
                ) : null}

                {active && run?.status !== "waiting" ? (
                  <div className="mt-2 flex flex-col gap-3 rounded-[20px] bg-ink p-5 text-sm text-white">
                    <div className="flex justify-between gap-3">
                      <span className="text-amber">
                        ● {run?.status === "queued" ? "في الانتظار حتى يتفرّغ متصفح…" : `${agent.name} تعمل الآن`}
                      </span>
                      <span className="text-[#C9C4DE]">{summaryBits.join(" · ")}</span>
                    </div>
                    {progress.current.length > 0 ? (
                      <div dir="auto" className="flex flex-col gap-1 text-[15px] leading-relaxed">
                        {progress.current.map((text, i) => (
                          <div key={i}>الآن: {text}</div>
                        ))}
                      </div>
                    ) : run?.status === "running" && progress.total > 0 ? (
                      <div className="text-[15px] text-[#C9C4DE]">تفكر في الخطوة التالية…</div>
                    ) : null}
                    {progress.plan && progress.plan.length > 0 ? (
                      <div className="rounded-2xl bg-white/10 p-3">
                        <div className="mb-1.5 text-xs text-[#C9C4DE]">خطة العمل</div>
                        <PlanList todos={progress.plan} />
                      </div>
                    ) : null}
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-1/3 animate-pulse bg-amber" />
                    </div>
                  </div>
                ) : null}

                {run && !active ? (
                  <div className="mt-2 rounded-3xl border border-line bg-white p-6">
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-soft">
                      <span>النتيجة · {summaryBits.join(" · ")}</span>
                      {run.model ? (
                        <span dir="ltr" title="النموذج الذي نفّذ المهمة" className="truncate font-mono">
                          {run.model}
                        </span>
                      ) : null}
                    </div>
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
                      <div className="mt-4">
                        <ArtifactList runId={runId} artifacts={artifacts} notes={notes} />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {active && artifacts.length > 0 ? <ArtifactList runId={runId} artifacts={artifacts} notes={notes} /> : null}

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

        {browserVisible ? (
          <aside className="relative order-first border-b border-line p-6 xl:sticky xl:top-0 xl:order-none xl:h-screen xl:w-[var(--browser-w)] xl:flex-shrink-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
            {/* Drag (or use the arrow keys) to resize; double-click resets. */}
            <div
              {...handleProps}
              className="group absolute inset-y-0 -right-1.5 z-10 hidden w-3 cursor-col-resize outline-none xl:block"
            >
              <span
                className={`absolute inset-y-0 right-1 w-1 rounded-full transition-colors group-hover:bg-violet/40 group-focus-visible:bg-violet ${
                  dragging ? "bg-violet" : ""
                }`}
              />
            </div>
            <LiveBrowser runId={runId} active={active} agentName={agent.name} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
