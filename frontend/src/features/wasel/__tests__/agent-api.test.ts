import { beforeEach, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api/browser", () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

it("creates a run under the browser-agent route", async () => {
  const { agentApi } = await import("@/lib/api/agent");
  post.mockResolvedValue({ id: "r1" });
  await agentApi.createRun({ organization: "org-1", task: "find leads" });
  expect(post).toHaveBeenCalledWith("/product/browser_agent/runs/", { organization: "org-1", task: "find leads" });
});

it("passes the event cursor as the `after` query parameter", async () => {
  const { agentApi } = await import("@/lib/api/agent");
  get.mockResolvedValue([]);
  await agentApi.events("run/with space", 4);
  expect(get).toHaveBeenCalledWith("/product/browser_agent/runs/run%2Fwith%20space/events/", { query: { after: 4 } });
});

it("treats only final statuses as terminal", async () => {
  const { isTerminal } = await import("@/lib/api/agent");
  expect(["queued", "running"].some((s) => isTerminal(s as never))).toBe(false);
  expect(["succeeded", "failed", "cancelled", "timeout"].every((s) => isTerminal(s as never))).toBe(true);
});
