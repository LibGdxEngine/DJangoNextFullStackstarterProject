import { AccessProvider } from "@/features/academy/access";
import { TeacherShell } from "@/components/shells/TeacherShell";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccessProvider>
      <TeacherShell>{children}</TeacherShell>
    </AccessProvider>
  );
}
