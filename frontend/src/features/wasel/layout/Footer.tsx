import Link from "next/link";
import { Logo } from "./Logo";

const COLUMNS = [
  {
    title: "المنتج",
    links: [
      { href: "/#examples", label: "أمثلة من الواقع" },
      { href: "/dashboard/team", label: "الفريق" },
      { href: "/dashboard/tasks", label: "أفكار جاهزة" },
      { href: "/pricing", label: "الأسعار" },
    ],
  },
  {
    title: "الحساب",
    links: [
      { href: "/login", label: "تسجيل الدخول" },
      { href: "/signup", label: "إنشاء حساب" },
      { href: "/dashboard/billing", label: "الفواتير والرصيد" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1240px] px-6 pb-16 pt-6 md:px-8">
      <div className="grid grid-cols-1 gap-10 border-t border-line pt-12 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            واصل موظف ذكاء اصطناعي يعمل في متصفح حقيقي، وينجز أعمالك من البداية إلى النهاية.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="text-sm font-semibold text-ink">{col.title}</div>
            <ul className="mt-4 flex flex-col gap-2.5 text-sm text-muted">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 flex flex-wrap items-center justify-between gap-4 text-sm text-muted">
        <span>© {new Date().getFullYear()} واصل. جميع الحقوق محفوظة.</span>
        <span>منتج من Blink Solutions · القاهرة</span>
      </div>
    </footer>
  );
}
