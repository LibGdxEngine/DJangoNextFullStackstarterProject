"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { StagePlaceholder } from "./StagePlaceholder";

export function ManageSectionPlaceholder({ section }: { section: string }) {
  const { t } = useI18n();
  const title = section === "import" ? t.placeholder.import : t.nav[section as keyof Dictionary["nav"]] ?? section;
  return <StagePlaceholder section={section} title={title} />;
}

export function TeacherSectionPlaceholder({ section }: { section: string }) {
  const { t } = useI18n();
  return <StagePlaceholder compact section={section} title={t.teacherNav[section as keyof Dictionary["teacherNav"]] ?? section} />;
}

export function FamilySectionPlaceholder({ section }: { section: string }) {
  const { t } = useI18n();
  return <StagePlaceholder compact section={section} title={t.familyNav[section as keyof Dictionary["familyNav"]] ?? section} />;
}
