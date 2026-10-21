import { AccessProvider } from "@/features/academy/access";
import { FamilyShell } from "@/components/shells/FamilyShell";

export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccessProvider>
      <FamilyShell>{children}</FamilyShell>
    </AccessProvider>
  );
}
