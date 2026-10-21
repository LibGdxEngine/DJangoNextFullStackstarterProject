// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentApi } from "@/lib/api/agent";
import { TasksLibrary } from "../dashboard/TasksLibrary";
import { TeamRoster } from "../dashboard/TeamRoster";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
vi.mock("../dashboard/workspace", () => ({
  useWorkspace: () => ({ status: "ready", organization: { id: "org-1" } }),
}));
vi.mock("@/lib/api/agent", () => ({
  agentApi: { listRoles: vi.fn(), createRole: vi.fn(), deleteRole: vi.fn(), listTaskTemplates: vi.fn() },
}));

const role = (over: Record<string, unknown>) => ({
  id: "r1", name: "سلمى", title: "تطوير العملاء", summary: "", skills: [], avatar: "/a.png", tint: "#fff",
  is_builtin: true, active_runs: 0, ...over,
});
const template = (over: Record<string, unknown>) => ({
  id: "t1", category: "leads", category_label: "عملاء ومبيعات", title: "عملاء", description: "",
  prompt: "اجمع عملاء", image: "/a.png", role: "r1", ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("shows each role's live status and links to assigning it", async () => {
  vi.mocked(agentApi.listRoles).mockResolvedValue([
    role({}), role({ id: "r2", name: "عمر", active_runs: 2 }),
  ] as never);
  render(<TeamRoster />);
  const assign = await screen.findByText("كلّف سلمى ←");
  expect(assign.getAttribute("href")).toBe("/dashboard?role=r1");
  expect(screen.getAllByText("● متاح")).toHaveLength(1);
  expect(screen.getAllByText("● تعمل الآن")).toHaveLength(1);
  expect(agentApi.listRoles).toHaveBeenCalledWith("org-1");
});

it("hires a new role and reloads the team", async () => {
  vi.mocked(agentApi.listRoles).mockResolvedValue([role({})] as never);
  vi.mocked(agentApi.createRole).mockResolvedValue(role({ id: "r9" }) as never);
  render(<TeamRoster />);
  fireEvent.click(await screen.findByText("＋ وظّف دور جديد"));
  fireEvent.change(screen.getByLabelText("اسم الموظف"), { target: { value: "منى" } });
  fireEvent.change(screen.getByLabelText("الدور"), { target: { value: "مصممة" } });
  fireEvent.change(screen.getByLabelText("وصف الدور"), { target: { value: "تصمم المنشورات" } });
  fireEvent.click(screen.getByText("وظّف"));
  await waitFor(() => expect(agentApi.listRoles).toHaveBeenCalledTimes(2));
  expect(agentApi.createRole).toHaveBeenCalledWith({
    organization: "org-1", name: "منى", title: "مصممة", summary: "تصمم المنشورات", instructions: "تصمم المنشورات",
  });
});

it("only offers to remove custom roles", async () => {
  vi.mocked(agentApi.listRoles).mockResolvedValue([role({}), role({ id: "r3", name: "منى", is_builtin: false })] as never);
  vi.mocked(agentApi.deleteRole).mockResolvedValue(undefined as never);
  render(<TeamRoster />);
  const remove = await screen.findAllByText("إزالة");
  expect(remove).toHaveLength(1);
  fireEvent.click(remove[0]);
  await waitFor(() => expect(agentApi.deleteRole).toHaveBeenCalledWith("r3"));
});

it("counts, filters and searches the task templates", async () => {
  vi.mocked(agentApi.listTaskTemplates).mockResolvedValue([
    template({}),
    template({ id: "t2", category: "sup", category_label: "خدمة العملاء", title: "الرد على الرسائل", prompt: "رد" }),
    template({ id: "t3", category: "sup", category_label: "خدمة العملاء", title: "متابعة", prompt: "تابع", role: null }),
  ] as never);
  render(<TasksLibrary />);
  await screen.findByText("الرد على الرسائل");
  const support = screen.getByRole("button", { name: /خدمة العملاء/ });
  expect(support.textContent).toContain("٢");

  fireEvent.click(support);
  expect(screen.queryByText("عملاء")).toBeNull();

  fireEvent.change(screen.getByLabelText("ابحث في الأفكار"), { target: { value: "متابعة" } });
  expect(screen.queryByText("الرد على الرسائل")).toBeNull();
  const use = screen.getByText("استخدمها ←");
  expect(use.getAttribute("href")).toBe(`/dashboard?task=${encodeURIComponent("تابع")}`);
});
