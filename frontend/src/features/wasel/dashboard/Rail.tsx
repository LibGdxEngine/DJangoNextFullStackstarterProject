"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const RAIL_ITEMS = [
  { href: "/dashboard", icon: "＋", label: "جديد / المحادثات", match: (p: string) => p === "/dashboard" || p.startsWith("/dashboard/conversations") },
  {
    href: "/dashboard/tasks",
    icon: "⚡",
    label: "أفكار جاهزة",
    match: (p: string) => p.startsWith("/dashboard/tasks"),
  },
  {
    href: "/dashboard/team",
    icon: "👥",
    label: "الفريق",
    match: (p: string) => p.startsWith("/dashboard/team"),
  },
];

export function Rail({ user }: { user: { name: string } }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-[76px] flex-shrink-0 flex-col items-center gap-2.5 border-l border-line bg-white py-5">
      <Link href="/" className="flex items-baseline text-[22px] font-bold">
        و<span className="inline-block h-1.5 w-1.5 rounded-full bg-amber" />
      </Link>
      <div className="h-4" />
      {RAIL_ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className="flex h-12 w-12 items-center justify-center rounded-[14px] text-lg"
            style={{
              background: active ? "#EEE8FF" : "transparent",
              color: active ? "#6D3BF5" : "#6B6880",
            }}
          >
            {item.icon}
          </Link>
        );
      })}
      <div className="flex-1" />
      <Link href="/dashboard/billing" className="text-xs text-muted hover:text-ink">
        الباقات
      </Link>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        title="تسجيل الخروج"
        className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-violet text-sm font-semibold text-white"
      >
        {(user.name || "?").charAt(0).toUpperCase()}
      </button>
    </aside>
  );
}
