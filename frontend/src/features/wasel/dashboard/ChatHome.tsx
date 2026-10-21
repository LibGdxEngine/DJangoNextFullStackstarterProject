"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { agents, allTasks } from "@/features/wasel/data";
import { agentApi } from "@/lib/api/agent";
import { describeApiError } from "@/lib/api/errors";
import { useWorkspace } from "./workspace";

const QUICK_TASKS = [allTasks[0], allTasks[3], allTasks[5]];
const GOAL_PREFIX = "متابعة مستمرة: ";

export function ChatHome({ initialTask = "" }: { initialTask?: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const workspace = useWorkspace();
  const [mode, setMode] = useState<"task" | "goal">("task");
  const [task, setTask] = useState(initialTask);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const userName = session?.user?.name || session?.username || "";
  const placeholder = useMemo(
    () =>
      mode === "task"
        ? "مثال: اجمع ٣٠ مطعمًا في المعادي وأرسل لهم عرض القائمة الرقمية"
        : "مثال: احجز لي ٢٠ اجتماعًا مع شركات لوجستية هذا الشهر",
    [mode]
  );

  async function handleSubmit() {
    const text = task.trim();
    if (!text || workspace.status !== "ready" || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const run = await agentApi.createRun({
        organization: workspace.organization.id,
        task: mode === "goal" ? `${GOAL_PREFIX}${text}` : text,
      });
      router.push(`/dashboard/conversations/${run.id}`);
    } catch (err) {
      setError(describeApiError(err).message);
      setSubmitting(false);
    }
  }

  const canSubmit = task.trim().length > 0 && workspace.status === "ready" && !submitting;

  return (
    <div className="mx-auto max-w-[920px] px-6 pt-16 pb-16 md:px-8">
      <div className="text-center">
        <div className="mb-[18px] flex justify-center">
          <div className="flex">
            {agents.map((a) => (
              <Image
                key={a.id}
                src={a.img}
                alt={a.name}
                width={52}
                height={52}
                className="-ml-3.5 h-[52px] w-[52px] rounded-full border-[3px] border-paper object-cover"
              />
            ))}
          </div>
        </div>
        <h1 className="text-[32px] font-bold md:text-[44px]">
          صباح الخير{userName ? ` يا ${userName}` : ""}.{" "}
          <span className="text-violet">ماذا ننجز اليوم؟</span>
        </h1>
        <p className="mt-3 text-[17px] text-muted">
          عملاء، متابعات، حملات، أو أي عمل آخر — اكتب طلبك وسيضع واصل خطة ويبدأ التنفيذ.
        </p>
      </div>

      <div className="mt-8 flex justify-center">
        <div className="flex gap-1 rounded-full bg-[#EDEBF5] p-1">
          <button
            onClick={() => setMode("task")}
            className="whitespace-nowrap rounded-full px-[22px] py-2.5 text-sm font-semibold"
            style={{ background: mode === "task" ? "#fff" : "transparent", color: mode === "task" ? "#0E0B1F" : "#6B6880" }}
          >
            ⚡ إنجاز
          </button>
          <button
            onClick={() => setMode("goal")}
            className="whitespace-nowrap rounded-full px-[22px] py-2.5 text-sm font-semibold"
            style={{ background: mode === "goal" ? "#fff" : "transparent", color: mode === "goal" ? "#0E0B1F" : "#6B6880" }}
          >
            ↻ متابعة مستمرة
          </button>
        </div>
      </div>

      <div
        className="mt-[18px] rounded-[26px] border-[1.5px] border-[#D9CCFF] bg-white p-5"
        style={{ boxShadow: "0 0 0 6px rgba(109,59,245,.07), 0 20px 50px rgba(14,11,31,.06)" }}
      >
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSubmit();
          }}
          placeholder={placeholder}
          aria-label="طلبك"
          className="min-h-[84px] w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-violet-tint px-3.5 py-2 text-[13px] font-medium text-violet">
              🌐 يعمل في متصفح حقيقي باسمك
            </span>
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            aria-label="أرسل الطلب"
            className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-violet text-xl text-white hover:bg-violet-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "…" : "↑"}
          </button>
        </div>
      </div>
      {error ? (
        <div role="alert" className="mt-3 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">
          {error}
        </div>
      ) : null}
      {workspace.status === "error" ? (
        <div role="alert" className="mt-3 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">
          تعذّر تجهيز مساحة العمل: {workspace.message}
        </div>
      ) : null}
      <div className="mt-3 text-center text-[13px] text-muted-soft">
        🔒 كلمات المرور لا تمر عبر واصل، وتُشفّر الجلسة فور إغلاق المتصفح.
      </div>

      <div className="mt-12 flex items-end justify-between">
        <div>
          <div className="text-xl font-bold">ابدأ بأحد هذه الأفكار</div>
          <div className="mt-1 text-sm text-muted">اختر فكرة، عدّلها، ثم أرسلها.</div>
        </div>
        <Link href="/dashboard/tasks" className="text-sm text-violet">
          كل الأفكار ←
        </Link>
      </div>
      <div className="mt-[18px] grid grid-cols-1 gap-4 sm:grid-cols-3">
        {QUICK_TASKS.map((idea) => (
          <button
            key={idea.title}
            onClick={() => setTask(idea.title)}
            className="overflow-hidden rounded-[22px] border border-line bg-white text-start hover:border-[#B9A3FF]"
          >
            <div className="aspect-[16/10] overflow-hidden">
              <Image src={idea.img} alt="" width={320} height={200} className="h-full w-full object-cover" />
            </div>
            <div className="px-4 pt-3.5 pb-[18px]">
              <div className="text-xs font-semibold text-violet">{idea.cat}</div>
              <div className="mt-1 text-base font-semibold">{idea.title}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
