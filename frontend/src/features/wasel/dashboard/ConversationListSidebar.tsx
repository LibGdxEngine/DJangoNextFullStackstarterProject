"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { agentApi, isTerminal, type AgentRun } from "@/lib/api/agent";
import { runStatusLabel, runTitle } from "./run-format";
import { useWorkspace } from "./workspace";

const REFRESH_MS = 8000;

export function ConversationListSidebar() {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const organizationId = workspace.status === "ready" ? workspace.organization.id : undefined;
  const [runs, setRuns] = useState<AgentRun[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await agentApi.listRuns(organizationId);
        if (!cancelled) setRuns(list);
      } catch {
        // The sidebar is a convenience; the conversation view reports real errors.
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [organizationId, pathname]);

  const active = runs.filter((run) => !isTerminal(run.status));
  const finished = runs.filter((run) => isTerminal(run.status));

  const renderRun = (run: AgentRun) => {
    const href = `/dashboard/conversations/${run.id}`;
    const status = runStatusLabel(run.status);
    return (
      <Link
        key={run.id}
        href={href}
        className="flex items-center gap-2.5 rounded-xl p-2.5"
        style={{ background: pathname === href ? "#EEE8FF" : "transparent" }}
      >
        <Image src="/agents/team.png" alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{runTitle(run.task)}</div>
          <div className="text-xs" style={{ color: status.color }}>
            {status.text}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-[clamp(200px,20vw,280px)] flex-shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line bg-[#FBFAFE] px-[18px] py-6 md:flex">
      <div className="flex items-center justify-between">
        <span className="text-xl font-bold">المحادثات</span>
        <Link
          href="/dashboard"
          aria-label="طلب جديد"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-line"
        >
          ＋
        </Link>
      </div>

      {active.length > 0 ? (
        <>
          <div className="mt-1.5 text-xs text-muted-soft">يعملون الآن</div>
          {active.map(renderRun)}
        </>
      ) : null}

      {finished.length > 0 ? (
        <>
          <div className="mt-1.5 text-xs text-muted-soft">السابقة</div>
          {finished.map(renderRun)}
        </>
      ) : null}

      {runs.length === 0 ? (
        <div className="mt-2 text-sm text-muted-soft">لا توجد محادثات بعد. ابدأ بطلب جديد.</div>
      ) : null}

      <div className="flex-1" />
      <div className="flex items-center justify-between rounded-[18px] bg-violet-tint p-4">
        <div>
          <div className="text-2xl font-bold">{runs.length.toLocaleString("ar-EG")}</div>
          <div className="text-xs text-muted">طلب</div>
        </div>
        <Link
          href="/dashboard/billing"
          className="flex-shrink-0 whitespace-nowrap rounded-full bg-violet px-4 py-2.5 text-[13px] text-white"
        >
          الباقات
        </Link>
      </div>
    </aside>
  );
}
