// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { agentApi } from "@/lib/api/agent";
import { ConversationView } from "../dashboard/ConversationView";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/api/agent", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/agent")>();
  return {
    ...real,
    agentApi: { getRun: vi.fn(), events: vi.fn(), artifacts: vi.fn(), cancel: vi.fn(), live: vi.fn(), control: vi.fn(), sendInput: vi.fn() },
  };
});

const baseRun = {
  id: "run-1", organization: "org-1", task: "افتح الموقع", final_text: "", error: "",
  usage: {}, cancel_requested: false, created_at: "", started_at: null, finished_at: null,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps polling new events until the run reaches a final state", async () => {
  vi.mocked(agentApi.getRun)
    .mockResolvedValueOnce({ ...baseRun, status: "running" } as never)
    .mockResolvedValue({ ...baseRun, status: "succeeded", final_text: "تم" } as never);
  vi.mocked(agentApi.events)
    .mockResolvedValueOnce([
      { seq: 0, kind: "tool_call", payload: { name: "browse", args: { url: "https://x.com/" }, id: "c1" }, created_at: "" },
      { seq: 1, kind: "tool_call", payload: { name: "fetch_page", args: { url: "https://noon.com/" }, id: "c2" }, created_at: "" },
      { seq: 2, kind: "tool_result", payload: { name: "fetch_page", content: "Fetch failed: TimeoutError: Timeout 20000ms exceeded.", call_id: "c2", status: "failed" }, created_at: "" },
    ] as never)
    .mockResolvedValue([
      { seq: 3, kind: "tool_result", payload: { name: "browse", content: "URL: https://x.com/\nTitle: X", call_id: "c1", status: "ok" }, created_at: "" },
      { seq: 4, kind: "message", payload: { text: "انتهيت" }, created_at: "" },
    ] as never);
  vi.mocked(agentApi.artifacts).mockResolvedValue([]);

  render(<ConversationView runId="run-1" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  // Steps read as sentences, the one still running is named on the progress card, failures are counted.
  expect(screen.getByText("يفتح صفحة على x.com")).toBeDefined();
  expect(screen.getByText("الآن: يفتح صفحة على x.com")).toBeDefined();
  expect(screen.getByText("الموقع لم يستجب في الوقت المحدد")).toBeDefined();
  expect(screen.getAllByText("٢ خطوة · ١ تعذّرت").length).toBeGreaterThan(0);
  expect(agentApi.events).toHaveBeenLastCalledWith("run-1", 0);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(agentApi.events).toHaveBeenLastCalledWith("run-1", 3);
  expect(screen.getByText("فتح: X")).toBeDefined();
  expect(screen.getByText("انتهيت")).toBeDefined();
  expect(screen.getByText("تم")).toBeDefined();

  // Final state: no further polling.
  const calls = vi.mocked(agentApi.getRun).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(vi.mocked(agentApi.getRun).mock.calls.length).toBe(calls);
});
