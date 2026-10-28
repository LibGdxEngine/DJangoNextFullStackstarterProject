import type { AgentRunStatus } from "@/lib/api/agent";

export function runTitle(task: string): string {
  const firstLine = task.trim().split("\n")[0] ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

const STATUS_LABELS: Record<AgentRunStatus, { text: string; color: string }> = {
  queued: { text: "في الانتظار", color: "#9A97AB" },
  running: { text: "● يعمل الآن", color: "#16A34A" },
  waiting: { text: "⏸ ينتظر ردّك", color: "#B45309" },
  succeeded: { text: "✓ اكتمل", color: "#16A34A" },
  failed: { text: "تعذّر التنفيذ", color: "#B91C1C" },
  cancelled: { text: "أُلغي", color: "#9A97AB" },
  timeout: { text: "انتهت المهلة", color: "#B45309" },
};

export function runStatusLabel(status: AgentRunStatus) {
  return STATUS_LABELS[status];
}
