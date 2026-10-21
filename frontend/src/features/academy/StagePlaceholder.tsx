"use client";

import React from "react";
import { Hammer } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ds/Card";
import { PageHeader } from "@/components/ds/PageHeader";
import { EmptyState } from "@/components/ds/States";
import { ButtonLink } from "@/components/ds/Button";
import { SECTION_STAGE } from "./sections";


export function StagePlaceholder({ section, title, compact }: { section: string; title: string; compact?: boolean }) {
  const { t } = useI18n();
  const stage = SECTION_STAGE[section] ?? 2;
  const body = (
    <EmptyState
      icon={<Hammer aria-hidden className="size-[22px]" />}
      title={t.placeholder.title(stage)}
      description={t.placeholder.body}
      actions={!compact && <ButtonLink href="/manage/students" size="sm">{t.placeholder.goStudents}</ButtonLink>}
    />
  );
  if (compact) {
    return (
      <>
        <h1 className="text-[22px] font-semibold">{title}</h1>
        <Card>{body}</Card>
      </>
    );
  }
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: title }]} breadcrumbLabel={t.common.breadcrumb} title={title} />
      <Card>{body}</Card>
    </>
  );
}
