import Link from "next/link";
import { Logo } from "./Logo";
import { Button } from "@/features/wasel/ui/Button";

const NAV_LINKS = [
  { href: "/#team", label: "الفريق" },
  { href: "/dashboard/tasks", label: "أفكار جاهزة" },
  { href: "/pricing", label: "الأسعار" },
];

export function SiteHeader({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const dark = variant === "dark";

  const nav = (
    <nav className={`hidden md:flex items-center gap-7 text-[15px] ${dark ? "text-[#C9C4DE]" : "text-muted"}`}>
      {NAV_LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={dark ? "hover:text-white" : "hover:text-ink"}>
          {l.label}
        </Link>
      ))}
    </nav>
  );

  const actions = (
    <div className="flex items-center gap-4">
      <Link
        href="/login"
        className={`text-[15px] ${dark ? "text-[#C9C4DE] hover:text-white" : "text-muted hover:text-ink"}`}
      >
        دخول
      </Link>
      <Button href="/signup" variant={dark ? "white" : "violet"} size="sm">
        ابدأ مجانًا ←
      </Button>
    </div>
  );

  if (dark) {
    return (
      <header className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 py-6 md:px-8">
        <div className="flex items-center gap-10">
          <Logo dark />
          {nav}
        </div>
        {actions}
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 py-4 md:px-8">
        <div className="flex items-center gap-10">
          <Logo />
          {nav}
        </div>
        {actions}
      </div>
    </header>
  );
}
