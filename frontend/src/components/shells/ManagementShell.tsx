"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle, BarChart3, BookOpen, Calendar, CreditCard, DollarSign, GraduationCap, Home, LayoutDashboard,
  List, Menu as MenuIcon, MessageCircle, Package, Search, Settings, User, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { settings, setupSteps } from "@/features/academy/fixtures";
import { Banner } from "@/components/ds/Panels";
import { CountBadge } from "@/components/ds/StatusBadge";
import { AccountMenu, AcademyClock, LanguageSwitch, LogoMark, NotificationsButton, useAcademyName } from "./ShellParts";

type NavKey = keyof Dictionary["nav"];

interface NavItem {
  key: NavKey;
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  badge?: { count: number; tone: "attention" | "on-dark" };
  dot?: boolean;
}

const groups: { label: keyof Dictionary["navGroups"] | null; items: NavItem[] }[] = [
  { label: null, items: [{ key: "overview", href: "/manage", icon: LayoutDashboard, badge: { count: 6, tone: "attention" } }] },
  { label: "people", items: [
    { key: "students", href: "/manage/students", icon: User },
    { key: "families", href: "/manage/families", icon: Home },
    { key: "teachers", href: "/manage/teachers", icon: GraduationCap },
  ] },
  { label: "operations", items: [
    { key: "schedule", href: "/manage/schedule", icon: Calendar },
    { key: "sessions", href: "/manage/sessions", icon: List },
    { key: "progress", href: "/manage/progress", icon: BookOpen },
  ] },
  { label: "money", items: [
    { key: "packages", href: "/manage/packages", icon: Package },
    { key: "payments", href: "/manage/payments", icon: CreditCard, badge: { count: 3, tone: "on-dark" } },
    { key: "payroll", href: "/manage/payroll", icon: DollarSign },
  ] },
  { label: "communication", items: [
    { key: "whatsapp", href: "/manage/whatsapp", icon: MessageCircle, dot: settings.whatsappStatus === "action_required" },
    { key: "reports", href: "/manage/reports", icon: BarChart3 },
  ] },
];

const allItems = [...groups.flatMap((g) => g.items), { key: "settings" as const, href: "/manage/settings", icon: Settings }, { key: "setup" as const, href: "/manage/setup", icon: Settings }];

function isActive(pathname: string, href: string) {
  return href === "/manage" ? pathname === "/manage" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <>
      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.label && <div className="px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-300">{t.navGroups[group.label]}</div>}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-sm",
                  active ? "bg-brand-100/15 font-medium text-white" : "text-brand-100 hover:bg-brand-100/10",
                )}
              >
                <Icon aria-hidden className="size-[18px] shrink-0" />
                <span className="flex-1">{t.nav[item.key]}</span>
                {item.badge && <CountBadge count={item.badge.count} tone={item.badge.tone} className="h-5 min-w-5" />}
                {item.dot && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="size-2 rounded-full bg-red-400" />
                    <span className="sr-only">{t.shell.connectionProblem}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function SetupProgress({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const done = setupSteps.filter((s) => s.done).length;
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-brand-100/10 p-2.5">
      <div className="flex justify-between text-xs">
        <span className="text-brand-300">{t.nav.setup}</span>
        <span className="text-white tabular">{done} / {setupSteps.length}</span>
      </div>
      <div className="h-1.5 rounded-full bg-brand-100/15" role="progressbar" aria-valuemin={0} aria-valuemax={setupSteps.length} aria-valuenow={done} aria-label={t.nav.setup}>
        <div className="h-full rounded-full bg-brand-300" style={{ width: `${(done / setupSteps.length) * 100}%` }} />
      </div>
      <Link href="/manage/setup" onClick={onNavigate} className="text-xs text-brand-100 hover:text-white">{t.shell.continueSetup}</Link>
    </div>
  );
}

export function ManagementShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const academyName = useAcademyName();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const current = [...allItems].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(pathname, i.href));
  const title = pathname.startsWith("/manage/design-system") ? t.home.designSystem : current ? t.nav[current.key] : t.nav.overview;

  useEffect(() => {
    const node = drawerRef.current;
    if (!node) return;
    if (drawerOpen && !node.open) node.showModal();
    if (!drawerOpen && node.open) node.close();
  }, [drawerOpen]);

  const brand = (
    <Link href="/manage" className="flex items-center gap-2.5 px-2.5 pb-4 pt-1.5 text-white">
      <LogoMark inverted />
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-semibold">{academyName}</span>
        <span className="text-[11px] text-brand-300">{t.workspaces.management}</span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-page">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">{t.shell.skipToContent}</a>

      {/* Desktop sidebar */}
      <nav aria-label={t.shell.mainNav} className="sticky top-0 hidden h-screen w-62 shrink-0 flex-col gap-0.5 overflow-y-auto bg-brand-900 px-3 py-5 text-brand-100 lg:flex">
        {brand}
        <NavLinks pathname={pathname} />
        <div className="flex-1" />
        <Link href="/manage/settings" aria-current={isActive(pathname, "/manage/settings") ? "page" : undefined} className="flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-brand-100 hover:bg-brand-100/10">
          <Settings aria-hidden className="size-[18px]" />{t.nav.settings}
        </Link>
        <SetupProgress />
      </nav>

      {/* Mobile drawer */}
      <dialog
        ref={drawerRef}
        aria-label={t.shell.mainNav}
        onClose={() => setDrawerOpen(false)}
        className="m-0 h-dvh max-h-dvh w-[300px] max-w-[85vw] bg-brand-900 p-0 text-brand-100 lg:hidden"
        style={{ marginInlineStart: 0, marginInlineEnd: "auto" }}
      >
        <div className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-4">
          <div className="flex items-start justify-between">
            {brand}
            <button type="button" aria-label={t.shell.closeMenu} onClick={() => setDrawerOpen(false)} className="inline-flex size-11 items-center justify-center rounded-[10px] text-brand-100 hover:bg-brand-100/10">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          <div className="flex-1" />
          <div className="flex items-center justify-between gap-2 pt-3">
            <Link href="/manage/settings" onClick={() => setDrawerOpen(false)} className="flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-brand-100 hover:bg-brand-100/10">
              <Settings aria-hidden className="size-[18px]" />{t.nav.settings}
            </Link>
            <LanguageSwitch onDark />
          </div>
          <SetupProgress onNavigate={() => setDrawerOpen(false)} />
        </div>
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 border-b border-line-soft bg-surface px-4 py-3 md:px-8">
          <button type="button" aria-label={t.shell.openMenu} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} className="inline-flex size-11 items-center justify-center rounded-[10px] border border-line text-secondary lg:hidden">
            <MenuIcon aria-hidden className="size-5" />
          </button>
          <div className="me-2 flex min-w-0 flex-col gap-0.5">
            <div className="hidden text-xs text-muted sm:block"><AcademyClock /></div>
            <div className="truncate text-lg font-semibold leading-tight">{title}</div>
          </div>
          <label className="relative ms-auto hidden max-w-[460px] flex-1 items-center md:flex">
            <span className="sr-only">{t.shell.globalSearch}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3 size-4 text-muted" />
            <input type="search" placeholder={t.shell.searchPlaceholder} className="h-10 w-full rounded-[10px] border border-line bg-page pe-14 ps-9 text-sm placeholder:text-muted" />
            <kbd className="absolute end-2.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted">⌘K</kbd>
          </label>
          <div className="ms-auto flex items-center gap-1.5 md:ms-0">
            <div className="hidden sm:block"><LanguageSwitch /></div>
            <NotificationsButton count={4} />
            <AccountMenu compact={false} />
          </div>
        </header>

        {settings.whatsappStatus === "action_required" && (
          <Banner
            icon={<AlertTriangle aria-hidden className="size-4 shrink-0" />}
            action={<Link href="/manage/whatsapp" className="font-semibold underline-offset-2 hover:underline">{t.shell.reconnect}</Link>}
          >
            <strong>{t.shell.whatsappDown}</strong> — {t.shell.whatsappDownDetail}
          </Banner>
        )}

        <main id="main" className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-4 pb-10 pt-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
