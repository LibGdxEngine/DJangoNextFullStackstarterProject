"use client";

import { useState } from "react";
import Image from "next/image";
import { SectionHeading } from "@/features/wasel/ui/SectionHeading";
import { examples } from "@/features/wasel/data";

export function Examples() {
  const [active, setActive] = useState(examples[0].key);
  const current = examples.find((e) => e.key === active) ?? examples[0];

  return (
    <section id="examples" className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <SectionHeading
        eyebrow="أمثلة من الواقع"
        title="ماذا يحدث عندما تطلب؟"
        description="اختر مجالًا لترى الطلب، وما يفعله واصل خطوة بخطوة، وما يصلك في النهاية."
      />

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {examples.map((ex) => {
          const isActive = ex.key === active;
          return (
            <button
              key={ex.key}
              onClick={() => setActive(ex.key)}
              className={`whitespace-nowrap rounded-full border px-5 py-2.5 text-[15px] font-semibold transition-colors ${
                isActive ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"
              }`}
            >
              {ex.label}
            </button>
          );
        })}
      </div>

      <div className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-7 rounded-[32px] border border-line bg-white p-8">
        <div className="flex flex-col gap-3.5">
          <div className="text-[13px] font-semibold text-muted-soft">الطلب</div>
          <div className="rounded-[22px] rounded-br-md bg-violet px-5 py-[18px] text-[17px] leading-relaxed text-white">
            {current.ask}
          </div>
          <div className="mt-auto flex items-center gap-2.5 text-sm text-muted">
            <Image
              src={current.img}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover object-[50%_25%]"
            />
            يتولّاه: <b className="text-ink">{current.who}</b>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="text-[13px] font-semibold text-muted-soft">ما يفعله واصل</div>
          {current.steps.map((step) => (
            <div key={step} className="flex items-start gap-3 text-[15px] leading-relaxed">
              <span className="font-bold text-success">✓</span>
              <span>{step}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-3xl bg-paper p-[22px]">
          <div className="text-[13px] font-semibold text-muted-soft">ما يصلك</div>
          {current.out.map((o) => (
            <div
              key={o.k}
              className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5"
            >
              <span className="text-sm">{o.k}</span>
              <b className="whitespace-nowrap text-lg text-violet">{o.v}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
