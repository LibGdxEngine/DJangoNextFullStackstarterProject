import Link from "next/link";
import { Briefcase, GraduationCap, Home, LogIn, Palette } from "lucide-react";
import { LogoMark } from "@/components/shells/ShellParts";

const workspaces = [
  { href: "/manage", icon: Briefcase, title: "Management", body: "Students, families, teachers, schedule, payments, payroll, WhatsApp, reports" },
  { href: "/teacher", icon: GraduationCap, title: "Teacher", body: "Today's classes, lesson reports, students and earnings (mobile-first)" },
  { href: "/family", icon: Home, title: "Family", body: "Next class, progress, cancel or reschedule, packages and payments" },
];

export default function LandingPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <div className="flex items-center gap-3">
        <LogoMark />
        <div className="leading-tight">
          <h1 className="text-2xl font-semibold">Quran Academy</h1>
          <p className="text-[13px] text-muted">Academy management platform — pick a workspace</p>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {workspaces.map(({ href, icon: Icon, title, body }) => (
          <li key={href}>
            <Link href={href} className="flex h-full flex-col gap-2 rounded-card border border-line-soft bg-surface p-4 hover:border-brand-300">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-100 text-brand-800"><Icon aria-hidden className="size-5" /></span>
              <span className="text-[15px] font-semibold">{title}</span>
              <span className="text-xs leading-relaxed text-muted">{body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 text-[13px]">
        <Link href="/sign-in" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand-800 px-4 font-medium text-white hover:bg-brand-700">
          <LogIn aria-hidden className="size-4" />Sign in
        </Link>
        <Link href="/manage/design-system" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 font-medium">
          <Palette aria-hidden className="size-4" />Design system
        </Link>
      </div>
      <p className="text-xs text-muted">Demo build: sign-in accepts any phone number and the code 123456. Data shown is sample data. The original starter dashboard is at /starter.</p>
    </main>
  );
}
