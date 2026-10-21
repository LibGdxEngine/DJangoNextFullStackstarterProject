import Link from "next/link";
import { Briefcase, GraduationCap, Home, LogIn, Palette } from "lucide-react";
import { LogoMark } from "@/components/shells/ShellParts";
import { site } from "@/config/site";
import { getLocale } from "@/i18n/server";

const copy = {
  en: {
    tagline: "Academy management platform — pick a workspace",
    workspaces: [
      { title: "Management", body: "Students, families, teachers, schedule, payments, payroll, WhatsApp, reports" },
      { title: "Teacher", body: "Today's classes, lesson reports, students and earnings (mobile-first)" },
      { title: "Family", body: "Next class, progress, cancel or reschedule, packages and payments" },
    ],
    signIn: "Sign in",
    designSystem: "Design system",
    demo: "Demo build: sign-in accepts any phone number and the code 123456. Data shown is sample data.",
  },
  ar: {
    tagline: "منصة إدارة الأكاديمية — اختر مساحة العمل",
    workspaces: [
      { title: "الإدارة", body: "الطلاب والأسر والمعلمون والجدول والمدفوعات والرواتب وواتساب والتقارير" },
      { title: "المعلم", body: "حصص اليوم وتقارير الدروس والطلاب والمستحقات" },
      { title: "الأسرة", body: "الحصة القادمة والتقدم والإلغاء أو إعادة الجدولة والباقات والمدفوعات" },
    ],
    signIn: "تسجيل الدخول",
    designSystem: "نظام التصميم",
    demo: "نسخة تجريبية: يقبل تسجيل الدخول أي رقم هاتف والرمز 123456. البيانات المعروضة بيانات نموذجية.",
  },
} as const;

const workspaceLinks = [
  { href: "/manage", icon: Briefcase },
  { href: "/teacher", icon: GraduationCap },
  { href: "/family", icon: Home },
];

export default async function LandingPage() {
  const locale = await getLocale();
  const t = copy[locale];
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <div className="flex items-center gap-3">
        <LogoMark />
        <div className="leading-tight">
          <h1 className="text-2xl font-semibold">{site.name[locale]}</h1>
          <p className="text-[13px] text-muted">{t.tagline}</p>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {workspaceLinks.map(({ href, icon: Icon }, i) => (
          <li key={href}>
            <Link href={href} className="flex h-full flex-col gap-2 rounded-card border border-line-soft bg-surface p-4 hover:border-brand-300">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-100 text-brand-800"><Icon aria-hidden className="size-5" /></span>
              <span className="text-[15px] font-semibold">{t.workspaces[i].title}</span>
              <span className="text-xs leading-relaxed text-muted">{t.workspaces[i].body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 text-[13px]">
        <Link href="/sign-in" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand-800 px-4 font-medium text-white hover:bg-brand-700">
          <LogIn aria-hidden className="size-4" />{t.signIn}
        </Link>
        <Link href="/manage/design-system" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 font-medium">
          <Palette aria-hidden className="size-4" />{t.designSystem}
        </Link>
      </div>
      <p className="text-xs text-muted">{t.demo}</p>
    </main>
  );
}
