"use client";

import React, { useEffect, useState } from "react";
import { Bell, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { settings } from "@/features/academy/fixtures";
import { MANAGEMENT_ROLES, useAccess } from "@/features/academy/access";
import { formatTime, zoneCity, zoneOffset } from "@/lib/format";
import { Menu } from "@/components/ds/Menu";
import { Avatar } from "@/components/ds/DetailHeader";

export function LogoMark({ inverted, className }: { inverted?: boolean; className?: string }) {
  const bg = inverted ? "#F3E4CF" : "#5B2A12";
  const fg = inverted ? "#5B2A12" : "#F3E4CF";
  return (
    <svg role="img" aria-label="Academy logo" width="32" height="32" viewBox="0 0 32 32" fill="none" className={className}>
      <rect width="32" height="32" rx="9" fill={bg} />
      <path d="M8 11c3-1.5 5.5-1.5 8 0 2.5-1.5 5-1.5 8 0v11c-3-1.5-5.5-1.5-8 0-2.5-1.5-5-1.5-8 0V11Z" fill={fg} />
      <path d="M16 11v11" stroke={bg} strokeWidth="1.6" />
      <path d="M21.5 6.5a4.5 4.5 0 1 0 4 2.5 3 3 0 0 1-4-2.5Z" fill={fg} />
    </svg>
  );
}

export function useAcademyName(): string {
  const { locale } = useI18n();
  return settings.name[locale];
}

/** Segmented EN | ع switch (management) or a single toggle button (compact shells). */
export function LanguageSwitch({ compact, onDark }: { compact?: boolean; onDark?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  if (compact) {
    const next = locale === "en" ? "ar" : "en";
    return (
      <button
        type="button"
        lang={next}
        aria-label={t.shell.switchLanguage}
        onClick={() => setLocale(next)}
        className={cn("inline-flex size-11 items-center justify-center rounded-[10px] border border-line bg-surface text-[15px] font-medium text-ink", next === "ar" && "font-arabic")}
      >
        {next === "ar" ? "ع" : "EN"}
      </button>
    );
  }
  return (
    <div role="group" aria-label={t.shell.language} className={cn("inline-flex h-10 overflow-hidden rounded-[10px] border", onDark ? "border-white/20" : "border-line")}>
      {(["en", "ar"] as const).map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
          className={cn(
            "px-3 text-[13px]",
            code === "ar" && "font-arabic text-sm",
            locale === code ? "bg-brand-800 font-semibold text-white" : onDark ? "bg-transparent text-brand-100" : "bg-surface font-medium text-ink",
          )}
        >
          {code === "en" ? "EN" : "ع"}
        </button>
      ))}
    </div>
  );
}

export function NotificationsButton({ count, size = "md" }: { count: number; size?: "md" | "lg" }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t.shell.notifications(count)}
      className={cn("relative inline-flex items-center justify-center rounded-[10px] border border-line bg-surface text-secondary", size === "lg" ? "size-11" : "size-10")}
    >
      <Bell aria-hidden className={size === "lg" ? "size-5" : "size-[18px]"} />
      {count > 0 && (size === "lg"
        ? <span aria-hidden className="absolute end-2 top-2 size-2 rounded-full bg-accent-600" />
        : <span aria-hidden className="absolute end-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-white">{count}</span>)}
    </button>
  );
}

/** Ticking "Mon 20 Oct · 14:32 Cairo (UTC+3)" in the academy zone. */
export function AcademyClock({ timeZone = settings.timezone, withDate = true }: { timeZone?: string; withDate?: boolean }) {
  const { tag } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the clock after mount to avoid hydration drift.
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <span className="invisible">00:00</span>;
  const iso = now.toISOString();
  const date = new Intl.DateTimeFormat(tag, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(now);
  return (
    <span className="tabular">
      {withDate && `${date} · `}{formatTime(iso, timeZone, tag)} {zoneCity(timeZone, tag)} ({zoneOffset(timeZone, now)})
    </span>
  );
}

/** Account menu: workspace switcher for multi-role users, plus the review-only role switch. */
export function AccountMenu({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const { userName, role, setRole } = useAccess();
  const router = useRouter();
  return (
    <Menu
      label={t.shell.accountMenu}
      items={[
        { label: t.workspaces.management, hint: t.shell.currentWorkspace, onSelect: () => router.push("/manage") },
        { label: t.workspaces.teacher, onSelect: () => router.push("/teacher") },
        { label: t.workspaces.family, onSelect: () => router.push("/family") },
        ...MANAGEMENT_ROLES.map((r) => ({
          label: `${t.shell.viewAs}: ${t.roles[r]}${r === role ? " ✓" : ""}`,
          hint: r === "admin" ? t.shell.roleHint : undefined,
          onSelect: () => setRole(r),
        })),
        { label: t.shell.signOut, onSelect: () => router.push("/sign-in") },
      ]}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={t.shell.accountFor(userName, t.roles[role])}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface pe-2.5 ps-1 text-[13px] font-medium text-ink"
        >
          <Avatar name={userName} />
          {!compact && (
            <span className="flex flex-col items-start leading-tight">
              <span>{userName}</span>
              <span className="text-[11px] font-normal text-muted">{t.roles[role]}</span>
            </span>
          )}
          <ChevronDown aria-hidden className="size-3.5" />
        </button>
      )}
    />
  );
}
