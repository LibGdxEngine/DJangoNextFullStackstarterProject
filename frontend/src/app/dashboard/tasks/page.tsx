import type { Metadata } from "next";
import { TasksLibrary } from "@/features/wasel/dashboard/TasksLibrary";

export const metadata: Metadata = { title: "أفكار جاهزة" };

export default function TasksPage() {
  return <TasksLibrary />;
}
