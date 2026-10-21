"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { allTasks, taskCategories } from "@/features/wasel/data";

export function TasksLibrary() {
  const [category, setCategory] = useState("all");

  const tasks = useMemo(
    () => (category === "all" ? allTasks : allTasks.filter((t) => t.key === category)),
    [category]
  );

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="flex items-center gap-3 text-4xl font-bold">
            أفكار جاهزة{" "}
            <span className="rounded-full bg-violet-tint px-3 py-1 text-sm font-semibold text-violet">
              ١٢٠
            </span>
          </h1>
          <p className="mt-2.5 text-base text-muted">
            عملاء، حملات، تقارير، وأكثر… اختر أي فكرة لتظهر في مربع الطلب، ثم عدّلها وأرسلها.
          </p>
        </div>
        <div className="w-full max-w-[320px] rounded-full border border-line bg-white px-5 py-3 text-sm text-muted-soft">
          🔍 ابحث في الأفكار
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {taskCategories.map((cat) => {
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
              <span className="text-xs opacity-70">{cat.count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[18px]">
        {tasks.map((task) => (
          <div key={task.title} className="flex flex-col overflow-hidden rounded-3xl border border-line bg-white">
            <div className="relative aspect-[4/3] overflow-hidden">
              <Image src={task.img} alt="" width={320} height={240} className="h-full w-full object-cover" />
              <span className="absolute right-3 top-3 rounded-full bg-white px-3 py-1.5 text-xs font-semibold">
                {task.cat}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-[18px] pt-4 pb-[18px]">
              <div className="text-[17px] font-bold">{task.title}</div>
              <div className="flex-1 text-sm leading-relaxed text-muted">{task.desc}</div>
              <Link
                href={`/dashboard?task=${encodeURIComponent(task.title)}`}
                className="mt-1 text-sm font-semibold text-violet"
              >
                استخدمها ←
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
