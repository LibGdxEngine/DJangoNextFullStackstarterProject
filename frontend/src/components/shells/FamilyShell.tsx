"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BookOpen, Calendar, CreditCard, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { families, students } from "@/features/academy/fixtures";
import { FAMILY_ACCOUNTS } from "@/features/academy/family-api";
import { zoneCity, zoneOffset } from "@/lib/format";
import { Avatar } from "@/components/ds/DetailHeader";
import { CompactShell } from "./CompactShell";
import { useAcademyName } from "./ShellParts";

const ACCOUNT_KEY = "academy_demo_family";

interface FamilyContextValue {
  familyId: string;
  /** "all" or a student id. */
  childId: string;
  isAdultAccount: boolean;
  setAccount: (kind: keyof typeof FAMILY_ACCOUNTS) => void;
}

const FamilyContext = createContext<FamilyContextValue | null>(null);

export function useFamilyChild() {
  const value = useContext(FamilyContext);
  if (!value) throw new Error("useFamilyChild must be used inside FamilyShell.");
  return value;
}

/**
 * Family workspace frame. Parents get a child switcher; adult students get no
 * switcher and "you" wording everywhere.
 */
export function FamilyShell({ children }: { children: React.ReactNode }) {
  const { t, tag } = useI18n();
  const academyName = useAcademyName();
  const [familyId, setFamilyId] = useState<string>(FAMILY_ACCOUNTS.parent);
  const family = families.find((f) => f.id === familyId)!;
  const kids = students.filter((s) => s.familyId === familyId && s.status !== "archived");
  const isAdultAccount = family.contacts[0]?.relationship === "self";
  const [childId, setChildId] = useState<string>(kids[0]?.id ?? "all");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ACCOUNT_KEY);
      if (stored === FAMILY_ACCOUNTS.adult || stored === FAMILY_ACCOUNTS.parent) {
        /* eslint-disable react-hooks/set-state-in-effect -- restore the review account after mount. */
        setFamilyId(stored);
        setChildId(students.find((s) => s.familyId === stored && s.status !== "archived")?.id ?? "all");
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // Storage unavailable: keep the parent account.
    }
  }, []);

  const setAccount = useCallback((kind: keyof typeof FAMILY_ACCOUNTS) => {
    const id = FAMILY_ACCOUNTS[kind];
    setFamilyId(id);
    setChildId(students.find((s) => s.familyId === id && s.status !== "archived")?.id ?? "all");
    try {
      window.localStorage.setItem(ACCOUNT_KEY, id);
    } catch {
      // Ignore.
    }
  }, []);

  const switcher = !isAdultAccount && kids.length > 1 ? (
    <div role="radiogroup" aria-label={t.family.childSwitcher} className="flex gap-2 overflow-x-auto px-4 pb-3">
      {[...kids.map((k) => ({ id: k.id, label: k.name.split(" ")[0], name: k.name })), { id: "all", label: t.family.allChildren, name: "" }].map((option, i) => {
        const active = childId === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setChildId(option.id)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full text-[13px] font-medium",
              option.name ? "pe-3 ps-1.5" : "px-3",
              active ? "bg-brand-800 text-white" : "border border-line bg-surface text-ink",
            )}
          >
            {option.name && <Avatar name={option.name} size="sm" tone={i % 2 ? "accent" : "brand"} />}
            {option.label}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <FamilyContext.Provider value={{ familyId, childId: isAdultAccount ? kids[0]?.id ?? "all" : childId, isAdultAccount, setAccount }}>
      <CompactShell
        title={academyName}
        subtitle={`${family.name} · ${zoneCity(family.timezone, tag)} (${zoneOffset(family.timezone)})`}
        navLabel={t.workspaces.family}
        notifications={1}
        headerExtra={switcher}
        nav={[
          { href: "/family", label: t.familyNav.home, icon: Home, exact: true },
          { href: "/family/schedule", label: t.familyNav.schedule, icon: Calendar },
          { href: "/family/progress", label: t.familyNav.progress, icon: BookOpen },
          { href: "/family/payments", label: t.familyNav.payments, icon: CreditCard },
        ]}
      >
        {children}
      </CompactShell>
    </FamilyContext.Provider>
  );
}
