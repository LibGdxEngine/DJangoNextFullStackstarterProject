// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentApi } from "@/lib/api/agent";
import { ChatHome } from "../dashboard/ChatHome";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "منى" } } }) }));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
vi.mock("../dashboard/workspace", () => ({
  useWorkspace: () => ({ status: "ready", organization: { id: "org-1" } }),
}));
const salma = { id: "role-1", name: "سلمى", title: "تطوير العملاء", avatar: "/agents/sales.png", is_builtin: true };
const template = {
  id: "tpl-1", category: "leads", category_label: "عملاء ومبيعات", title: "٥٠ عميلًا محتملًا",
  description: "", prompt: "اجمع ٥٠ نشاطًا تجاريًا", image: "/agents/sales.png", role: "role-1",
};
vi.mock("@/lib/api/agent", () => ({
  agentApi: {
    createRun: vi.fn(),
    listRoles: vi.fn(async () => [salma]),
    listTaskTemplates: vi.fn(async () => [template]),
  },
}));
afterEach(cleanup);

it("creates a run in the user's organization and opens its conversation", async () => {
  vi.mocked(agentApi.createRun).mockResolvedValue({ id: "run-9" } as never);
  render(<ChatHome />);
  fireEvent.change(screen.getByLabelText("طلبك"), { target: { value: "اجمع ٣٠ مطعمًا" } });
  fireEvent.click(screen.getByLabelText("أرسل الطلب"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/conversations/run-9"));
  expect(agentApi.createRun).toHaveBeenCalledWith({ organization: "org-1", task: "اجمع ٣٠ مطعمًا" });
});

it("prefills the request from a suggested task", () => {
  render(<ChatHome initialTask="مهمة جاهزة" />);
  expect((screen.getByLabelText("طلبك") as HTMLTextAreaElement).value).toBe("مهمة جاهزة");
});

it("shows the backend error and stays on the page when the run cannot be created", async () => {
  vi.mocked(agentApi.createRun).mockRejectedValue(new Error("Too many runs are already active"));
  render(<ChatHome />);
  fireEvent.change(screen.getByLabelText("طلبك"), { target: { value: "مهمة" } });
  fireEvent.click(screen.getByLabelText("أرسل الطلب"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many runs"));
  expect(push).not.toHaveBeenCalled();
});

it("sends the role chosen on the Team page with the run", async () => {
  vi.mocked(agentApi.createRun).mockResolvedValue({ id: "run-3" } as never);
  render(<ChatHome initialRole="role-1" />);
  await screen.findByText("سلمى · تطوير العملاء");
  fireEvent.change(screen.getByLabelText("طلبك"), { target: { value: "مهمة" } });
  fireEvent.click(screen.getByLabelText("أرسل الطلب"));
  await waitFor(() =>
    expect(agentApi.createRun).toHaveBeenLastCalledWith({ organization: "org-1", task: "مهمة", role: "role-1" })
  );
});

it("fills the request and its role from a suggested template", async () => {
  render(<ChatHome />);
  fireEvent.click(await screen.findByText("٥٠ عميلًا محتملًا"));
  expect((screen.getByLabelText("طلبك") as HTMLTextAreaElement).value).toBe("اجمع ٥٠ نشاطًا تجاريًا");
  expect(screen.getByText("سلمى · تطوير العملاء")).toBeTruthy();
});
