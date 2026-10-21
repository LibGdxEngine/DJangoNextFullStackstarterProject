"use client";

import React from "react";
import { Calendar, Clock, Users, Wallet } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { teachers } from "@/features/academy/fixtures";
import { CompactShell } from "./CompactShell";
import { AcademyClock } from "./ShellParts";

export function TeacherShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const teacher = teachers[0];
  return (
    <CompactShell
      title={teacher.name}
      subtitle={<>{t.workspaces.teacher} · <AcademyClock timeZone={teacher.timezone} withDate={false} /></>}
      navLabel={t.workspaces.teacher}
      notifications={2}
      nav={[
        { href: "/teacher", label: t.teacherNav.today, icon: Clock, exact: true },
        { href: "/teacher/schedule", label: t.teacherNav.schedule, icon: Calendar },
        { href: "/teacher/students", label: t.teacherNav.students, icon: Users },
        { href: "/teacher/earnings", label: t.teacherNav.earnings, icon: Wallet },
      ]}
    >
      {children}
    </CompactShell>
  );
}
