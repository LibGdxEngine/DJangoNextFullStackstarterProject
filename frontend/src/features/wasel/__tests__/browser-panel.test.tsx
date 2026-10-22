// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentApi } from "@/lib/api/agent";
import { ArtifactList } from "../dashboard/ArtifactList";
import { LiveBrowser } from "../dashboard/LiveBrowser";
import { DEFAULT_PANEL_PCT, useResizablePanel } from "../dashboard/useResizablePanel";

vi.mock("@/lib/api/agent", () => ({
  agentApi: { downloadArtifact: vi.fn(), live: vi.fn(), control: vi.fn(), sendInput: vi.fn() },
}));

// jsdom has no PointerEvent, so pointer events would lose their coordinates.
if (!("PointerEvent" in window)) {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.assign(window, { PointerEvent: PointerEventShim });
}

// jsdom gives an origin-less test page no localStorage; a small in-memory one stands in.
const memory = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(agentApi.live).mockResolvedValue({
    frame: { seq: 1, image: "QUJD", url: "https://a.example/", captured_at: "", live: true },
    state: { control: "agent", help: "" },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("downloads a file the agent saved when its button is clicked", async () => {
  const blob = new Blob(["a,b\n"], { type: "text/csv" });
  vi.mocked(agentApi.downloadArtifact).mockResolvedValue(blob);
  const createObjectURL = vi.fn(() => "blob:report");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  render(
    <ArtifactList
      runId="r1"
      artifacts={[{ id: "a1", kind: "file", path: "workspace/reports/leads.csv", size: 2048, created_at: "" }]}
    />,
  );
  expect(screen.getByText("2.0 KB")).toBeDefined();
  fireEvent.click(screen.getByTitle("تنزيل leads.csv"));

  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(agentApi.downloadArtifact).toHaveBeenCalledWith("r1", "a1");
  expect(createObjectURL).toHaveBeenCalledWith(blob);
  const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
  expect(link.download).toBe("leads.csv");
});

it("shows the error when a download fails", async () => {
  vi.mocked(agentApi.downloadArtifact).mockRejectedValue(new Error("The request timed out."));
  render(<ArtifactList runId="r1" artifacts={[{ id: "a1", kind: "screenshot", path: "screenshots/x.png", size: 10, created_at: "" }]} />);
  fireEvent.click(screen.getByTitle("تنزيل x.png"));
  expect((await screen.findByRole("alert")).textContent).toContain("timed out");
});

it("enters real full screen when the browser allows it", async () => {
  const request = vi.fn(async function (this: HTMLElement) {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  HTMLElement.prototype.requestFullscreen = request;
  render(<LiveBrowser runId="r1" active agentName="سلمى" />);

  await act(async () => fireEvent.click(screen.getByLabelText("ملء الشاشة")));
  expect(request).toHaveBeenCalled();
  expect(screen.getByLabelText("إغلاق ملء الشاشة")).toBeDefined();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

it("falls back to an in-page overlay that Esc closes", async () => {
  HTMLElement.prototype.requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"));
  const { container } = render(<LiveBrowser runId="r1" active agentName="سلمى" />);

  await act(async () => fireEvent.click(screen.getByLabelText("ملء الشاشة")));
  expect(container.firstElementChild?.className).toContain("fixed inset-0");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.firstElementChild?.className).not.toContain("fixed");
  expect(screen.getByLabelText("ملء الشاشة")).toBeDefined();
});

it("falls back to the overlay when a full-screen request never settles", async () => {
  vi.useFakeTimers();
  HTMLElement.prototype.requestFullscreen = vi.fn(() => new Promise<void>(() => undefined));
  const { container } = render(<LiveBrowser runId="r1" active agentName="سلمى" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  fireEvent.click(screen.getByLabelText("ملء الشاشة"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(container.firstElementChild?.className).toContain("fixed inset-0");
  vi.useRealTimers();
});

function Panel() {
  const { containerRef, pct, handleProps } = useResizablePanel();
  return (
    <div ref={containerRef} data-testid="row">
      <div {...handleProps} />
      <span>{Math.round(pct)}</span>
    </div>
  );
}

it("resizes the panel by dragging and with the keyboard, and remembers the width", () => {
  render(<Panel />);
  expect(screen.getByText(String(DEFAULT_PANEL_PCT))).toBeDefined();
  screen.getByTestId("row").getBoundingClientRect = () => ({ left: 100, width: 1000 }) as DOMRect;
  const handle = screen.getByRole("separator");
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();

  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 560 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 700 });
  expect(screen.getByText("60")).toBeDefined();
  expect(window.localStorage.getItem("wasel.browserPanelWidth")).toBe("60");

  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 700 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1095 }); // past the limit
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 1095 });
  expect(screen.getByText("75")).toBeDefined();

  // A flick: press and release with no moves in between still lands where it was released.
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 850 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 });
  expect(screen.getByText("40")).toBeDefined();
  for (let i = 0; i < 18; i++) fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(screen.getByText("75")).toBeDefined(); // capped

  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle.getAttribute("aria-valuenow")).toBe("73");
  fireEvent.doubleClick(handle);
  expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_PANEL_PCT));
});

it("restores a remembered width", () => {
  window.localStorage.setItem("wasel.browserPanelWidth", "38");
  render(<Panel />);
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("38");
});
