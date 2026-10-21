import { AccessProvider } from "@/features/academy/access";
import { ManagementShell } from "@/components/shells/ManagementShell";

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccessProvider>
      <ManagementShell>{children}</ManagementShell>
    </AccessProvider>
  );
}
