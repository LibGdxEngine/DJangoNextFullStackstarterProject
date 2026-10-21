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
    agentApi: { getRun: vi.fn(), events: vi.fn(), artifacts: vi.fn(), cancel: vi.fn(), liveFrame: vi.fn() },
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
    .mockResolvedValueOnce([{ seq: 0, kind: "tool_call", payload: { name: "browse", args: { url: "x.com" } }, created_at: "" }] as never)
    .mockResolvedValue([{ seq: 1, kind: "message", payload: { text: "انتهيت" }, created_at: "" }] as never);
  vi.mocked(agentApi.artifacts).mockResolvedValue([]);

  render(<ConversationView runId="run-1" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(/browse/)).toBeDefined();
  expect(agentApi.events).toHaveBeenLastCalledWith("run-1", 0);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(agentApi.events).toHaveBeenLastCalledWith("run-1", 1);
  expect(screen.getByText("انتهيت")).toBeDefined();
  expect(screen.getByText("تم")).toBeDefined();

  // Final state: no further polling.
  const calls = vi.mocked(agentApi.getRun).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(vi.mocked(agentApi.getRun).mock.calls.length).toBe(calls);
});
