// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { agentApi } from "@/lib/api/agent";
import { LiveBrowser } from "../dashboard/LiveBrowser";

vi.mock("@/lib/api/agent", () => ({ agentApi: { liveFrame: vi.fn() } }));

const frame = (seq: number, url: string, live = true) =>
  ({ seq, image: "QUJD", url, captured_at: "", live });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows new frames while the run is active, asking only for newer ones", async () => {
  vi.mocked(agentApi.liveFrame)
    .mockResolvedValueOnce(frame(1, "https://a.example/"))
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue(frame(2, "https://b.example/"));

  render(<LiveBrowser runId="r1" active />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText("https://a.example/")).toBeDefined();
  expect(screen.getByText("● مباشر")).toBeDefined();
  expect((screen.getByRole("img") as HTMLImageElement).src).toBe("data:image/jpeg;base64,QUJD");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(agentApi.liveFrame).toHaveBeenNthCalledWith(1, "r1", -1);
  expect(agentApi.liveFrame).toHaveBeenNthCalledWith(2, "r1", 1);
  expect(screen.getByText("https://b.example/")).toBeDefined();
});

it("fetches the last frame once and stops polling after the run ends", async () => {
  vi.mocked(agentApi.liveFrame).mockResolvedValue(frame(5, "https://done.example/", false));
  render(<LiveBrowser runId="r2" active={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(agentApi.liveFrame).toHaveBeenCalledTimes(1);
  expect(screen.getByText("آخر لقطة")).toBeDefined();
});
