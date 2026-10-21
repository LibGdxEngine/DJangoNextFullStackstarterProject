"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageSwitch, LogoMark, NotificationsButton } from "./ShellParts";

export interface CompactNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  exact?: boolean;
}

/**
 * Shared frame for the Teacher and Family workspaces: compact header, content,
 * and bottom navigation (a top tab bar from md up). 44px touch targets.
 */
export function CompactShell({ title, subtitle, navLabel, nav, notifications, headerExtra, children }: {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  navLabel: string;
  nav: CompactNavItem[];
  notifications: number;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const isActive = (item: CompactNavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  const links = (variant: "bottom" | "top") => nav.map((item) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          variant === "bottom"
            ? "flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-center text-[11px] leading-tight"
            : "flex h-11 items-center gap-2 rounded-[10px] px-3 text-sm",
          active ? "bg-brand-50 font-semibold text-brand-800" : "font-medium text-secondary hover:bg-page",
        )}
      >
        <Icon aria-hidden className={variant === "bottom" ? "size-[22px]" : "size-[18px]"} />
        {item.label}
      </Link>
    );
  });

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">{t.shell.skipToContent}</a>
      <header className="sticky top-0 z-20 border-b border-line-soft bg-surface">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2.5 px-4 pb-3 pt-3.5">
          <LogoMark />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-semibold">{title}</div>
            <div className="truncate text-xs text-muted tabular">{subtitle}</div>
          </div>
          <LanguageSwitch compact />
          <NotificationsButton count={notifications} size="lg" />
        </div>
        {headerExtra && <div className="mx-auto w-full max-w-4xl">{headerExtra}</div>}
        <nav aria-label={navLabel} className="mx-auto hidden w-full max-w-4xl gap-1 px-4 pb-2 md:flex">{links("top")}</nav>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3.5 p-4 pb-28 md:pb-10">{children}</main>

      <nav aria-label={navLabel} className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line-soft bg-surface px-2 pb-[max(18px,env(safe-area-inset-bottom))] pt-1.5 md:hidden" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {links("bottom")}
      </nav>
    </div>
  );
}
