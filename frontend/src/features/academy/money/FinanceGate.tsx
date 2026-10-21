"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ds/Card";
import { PageHeader } from "@/components/ds/PageHeader";
import { PermissionDenied } from "@/components/ds/States";
import { useAccess } from "../access";

/** Money pages need view_finance; the page shell stays so the denial is explained in place. */
export function FinanceGate({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useI18n();
  const { can, role } = useAccess();
  if (can("view_finance")) return <>{children}</>;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t.common.academy, href: "/manage" }, { label: title }]} breadcrumbLabel={t.common.breadcrumb} title={title} />
      <Card><PermissionDenied title={t.money.restricted(title)} description={t.common.roleCannot(t.roles[role])} onRequestAccess={() => undefined} /></Card>
    </>
  );
}
