// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { agentApi } from "@/lib/api/agent";
import { LiveBrowser } from "../dashboard/LiveBrowser";

vi.mock("@/lib/api/agent", () => ({ agentApi: { live: vi.fn(), control: vi.fn(), sendInput: vi.fn() } }));

const frame = (seq: number, url: string, live = true) =>
  ({ seq, image: "QUJD", url, captured_at: "", live });
const state = (control: "agent" | "waiting" | "user", help = "") => ({ control, help });

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(agentApi.sendInput).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows new frames while the run is active, asking only for newer ones", async () => {
  vi.mocked(agentApi.live)
    .mockResolvedValueOnce({ frame: frame(1, "https://a.example/"), state: state("agent") })
    .mockResolvedValueOnce({ frame: null, state: state("agent") })
    .mockResolvedValue({ frame: frame(2, "https://b.example/"), state: state("agent") });

  render(<LiveBrowser runId="r1" active agentName="سلمى" />);
  await flush();
  expect(screen.getByText("https://a.example/")).toBeDefined();
  expect(screen.getByText("● مباشر")).toBeDefined();

  await flush(1500);
  expect(agentApi.live).toHaveBeenNthCalledWith(1, "r1", -1);
  expect(agentApi.live).toHaveBeenNthCalledWith(2, "r1", 1);
  expect(screen.getByText("https://b.example/")).toBeDefined();
});

it("fetches the last frame once and stops polling after the run ends", async () => {
  vi.mocked(agentApi.live).mockResolvedValue({ frame: frame(5, "https://done.example/", false), state: state("agent") });
  render(<LiveBrowser runId="r2" active={false} agentName="سلمى" />);
  await flush(5000);
  expect(agentApi.live).toHaveBeenCalledTimes(1);
  expect(screen.getByText("آخر لقطة")).toBeDefined();
  expect(screen.queryByText("✋ تحكّم بنفسك")).toBeNull();
});

it("takes control, then forwards clicks, typing and special keys", async () => {
  vi.mocked(agentApi.live).mockResolvedValueOnce({ frame: frame(1, "https://a.example/"), state: state("agent") });
  vi.mocked(agentApi.control).mockResolvedValue(state("user"));
  render(<LiveBrowser runId="r3" active agentName="سلمى" />);
  await flush();
  vi.mocked(agentApi.live).mockResolvedValue({ frame: null, state: state("user") });

  fireEvent.click(screen.getByText("✋ تحكّم بنفسك"));
  await flush();
  expect(agentApi.control).toHaveBeenCalledWith("r3", "take");
  expect(screen.getByText("✋ أنت تتحكم")).toBeDefined();

  const browser = screen.getByLabelText("المتصفح: انقر واكتب للتحكم");
  browser.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
  fireEvent.click(browser, { clientX: 50, clientY: 25, detail: 1 });
  await flush();
  expect(agentApi.sendInput).toHaveBeenLastCalledWith("r3", [{ type: "click", x: 0.25, y: 0.25, count: 1 }]);

  fireEvent.keyDown(browser, { key: "Enter" });
  await flush();
  expect(agentApi.sendInput).toHaveBeenLastCalledWith("r3", [{ type: "key", key: "Enter", modifiers: 0 }]);

  fireEvent.keyDown(browser, { key: "a", ctrlKey: true });
  await flush();
  expect(agentApi.sendInput).toHaveBeenLastCalledWith("r3", [{ type: "key", key: "a", modifiers: 2 }]);

  fireEvent.keyDown(browser, { key: "س" });
  await flush();
  expect(agentApi.sendInput).toHaveBeenLastCalledWith("r3", [{ type: "text", text: "س" }]);

  fireEvent.click(screen.getByText(/سلّم المتصفح/));
  await flush();
  expect(agentApi.control).toHaveBeenLastCalledWith("r3", "release");
});

it("merges keystrokes typed while a request is in flight", async () => {
  vi.mocked(agentApi.live).mockResolvedValue({ frame: frame(1, "https://a.example/"), state: state("user") });
  let resolveFirst: () => void = () => undefined;
  vi.mocked(agentApi.sendInput)
    .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValue(undefined);
  render(<LiveBrowser runId="r4" active agentName="سلمى" />);
  await flush();

  const browser = screen.getByLabelText("المتصفح: انقر واكتب للتحكم");
  for (const key of ["h", "e", "l", "l", "o"]) fireEvent.keyDown(browser, { key });
  await flush();
  resolveFirst();
  await flush();
  expect(agentApi.sendInput).toHaveBeenNthCalledWith(1, "r4", [{ type: "text", text: "h" }]);
  expect(agentApi.sendInput).toHaveBeenNthCalledWith(2, "r4", [{ type: "text", text: "ello" }]);
});

it("surfaces the agent's request for help", async () => {
  vi.mocked(agentApi.live).mockResolvedValue({ frame: null, state: state("agent", "سجّل الدخول إلى Gmail") });
  render(<LiveBrowser runId="r5" active agentName="سلمى" />);
  await flush();
  expect(screen.getByText(/سجّل الدخول إلى Gmail/)).toBeDefined();
  expect(screen.getByText("✋ تولَّ المتصفح")).toBeDefined();
});
