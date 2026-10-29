"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TaskTemplate } from "@/lib/api/agent";
import { useTaskTemplates } from "./useCatalog";

function templateHref(template: TaskTemplate): string {
  const params = new URLSearchParams({ task: template.prompt });
  if (template.role) params.set("role", template.role);
  return `/dashboard?${params}`;
}

function TemplateCard({ template }: { template: TaskTemplate }) {
  const href = templateHref(template);
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-line bg-white">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image src={template.image} alt="" width={320} height={240} className="h-full w-full object-cover" />
        <span className="absolute right-3 top-3 rounded-full bg-white px-3 py-1.5 text-xs font-semibold">
          {template.category_label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-[18px] pt-4 pb-[18px]">
        <div className="text-[17px] font-bold">{template.title}</div>
        <div className="flex-1 text-sm leading-relaxed text-muted">{template.description}</div>
        <Link href={href} className="mt-1 text-sm font-semibold text-violet">
          استخدمها ←
        </Link>
      </div>
    </div>
  );
}

export function TasksLibrary() {
  const templates = useTaskTemplates();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const all = templates.data;
  const categories = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const t of all ?? []) {
      const entry = counts.get(t.category) ?? { label: t.category_label, count: 0 };
      entry.count += 1;
      counts.set(t.category, entry);
    }
    return [
      { key: "all", label: "الكل", count: all?.length ?? 0 },
      ...[...counts].map(([key, { label, count }]) => ({ key, label, count })),
    ];
  }, [all]);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (all ?? []).filter(
      (t) =>
        (category === "all" || t.category === category) &&
        (!query || `${t.title} ${t.description} ${t.prompt}`.toLowerCase().includes(query))
    );
  }, [all, category, search]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="flex items-center gap-3 text-4xl font-bold">
            أفكار جاهزة{" "}
            {all ? (
              <span className="rounded-full bg-violet-tint px-3 py-1 text-sm font-semibold text-violet">
                {all.length.toLocaleString("ar-EG")}
              </span>
            ) : null}
          </h1>
          <p className="mt-2.5 text-base text-muted">
            عملاء، حملات، تقارير، وأكثر… اختر أي فكرة لتظهر في مربع الطلب، ثم عدّلها وأرسلها.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 ابحث في الأفكار"
          aria-label="ابحث في الأفكار"
          className="w-full max-w-[320px] rounded-full border border-line bg-white px-5 py-3 text-sm outline-none focus:border-violet"
        />
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {categories.map((cat) => {
          const active = category === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className="flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2.5 text-sm"
              style={{
                borderColor: active ? "#0E0B1F" : "#E7E4F0",
                background: active ? "#0E0B1F" : "#fff",
                color: active ? "#fff" : "#0E0B1F",
              }}
            >
              {cat.label}
              <span className="text-xs opacity-70">{cat.count.toLocaleString("ar-EG")}</span>
            </button>
          );
        })}
      </div>

      {templates.error ? (
        <div role="alert" className="mt-7 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#B91C1C]">
          {templates.error}
        </div>
      ) : !all ? (
        <div className="mt-7 text-sm text-muted">جارٍ التحميل…</div>
      ) : shown.length === 0 ? (
        <div className="mt-7 text-sm text-muted">لا توجد أفكار مطابقة.</div>
      ) : (
        <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[18px]">
          {shown.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}
