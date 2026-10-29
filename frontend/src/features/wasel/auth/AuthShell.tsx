import { Logo } from "@/features/wasel/layout/Logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-ink px-6 py-12 text-white"
      style={{
        backgroundImage:
          "radial-gradient(900px 500px at 50% 105%, rgba(109,59,245,.45), transparent 70%), radial-gradient(500px 300px at 85% -10%, rgba(255,181,71,.10), transparent 70%)",
      }}
    >
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Logo dark />
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white p-8 text-ink shadow-[0_30px_80px_rgba(0,0,0,.35)]">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>

        <div className="mt-6 text-center text-sm text-[#C9C4DE]">{footer}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

export const authInputClass =
  "w-full rounded-xl border border-line bg-paper px-4 py-3 text-[15px] outline-none focus:border-violet focus:ring-2 focus:ring-violet/20";

export function AuthError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">{message}</div>
  );
}
