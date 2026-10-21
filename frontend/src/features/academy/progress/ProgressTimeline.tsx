"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatDate, formatNumber, formatRef } from "@/lib/format";
import { surahName, ayahRef } from "../quran";
import type { QuranProgress } from "../types";

/** "★★★★☆" with an accessible label. */
export function Rating({ value }: { value: number }) {
  const { t } = useI18n();
  return (
    <span className="text-xs text-accent-600 tabular" role="img" aria-label={t.quran.rating(value)}>
      {"★".repeat(value)}<span className="text-line">{"★".repeat(5 - value)}</span>
    </span>
  );
}

/** Surah name + "92:12–21". */
export function SurahRef({ entry }: { entry: Pick<QuranProgress, "surah" | "ayahFrom" | "ayahTo"> }) {
  const { tag, locale } = useI18n();
  return (
    <span className="font-semibold">
      {surahName(entry.surah, locale)}{" "}
      <span className="font-normal text-muted tabular" dir="ltr">{ayahRef(entry.surah, entry.ayahFrom, entry.ayahTo, (n) => formatNumber(n, tag))}</span>
    </span>
  );
}

/** Chronological record (newest first) with surah/ayah references. */
export function ProgressTimeline({ entries, showSession, extra }: {
  entries: QuranProgress[];
  showSession?: boolean;
  extra?: (entry: QuranProgress) => React.ReactNode;
}) {
  const { t, tag } = useI18n();
  return (
    <ol className="relative flex flex-col gap-3 border-s-2 border-brand-100 ps-5">
      {entries.map((p) => (
        <li key={p.id} className="relative flex flex-col gap-1 rounded-xl border border-line-soft bg-surface p-3.5">
          <span aria-hidden className="absolute -start-[27px] top-4 size-3 rounded-full border-2 border-surface bg-brand-700" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <SurahRef entry={p} />
            <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-secondary">{t.quran.activity[p.activity]}</span>
            <Rating value={p.rating} />
            <span className="ms-auto text-xs text-muted tabular">
              {formatDate(p.date, tag)}{showSession && p.sessionNumber ? ` · #${formatRef(p.sessionNumber, tag)}` : ""}
            </span>
          </div>
          {p.note && <p className="text-[13px] text-secondary">{p.note}</p>}
          {extra?.(p)}
        </li>
      ))}
    </ol>
  );
}
