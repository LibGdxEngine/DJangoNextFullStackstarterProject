"use client";

import { useState } from "react";
import { faqs } from "@/features/wasel/data";

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section className="mx-auto max-w-[900px] px-6 py-16 md:px-8">
      <h2 className="mb-7 text-center text-[42px] font-bold">أسئلة شائعة</h2>
      <div className="flex flex-col gap-2.5">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <button
              key={f.q}
              onClick={() => setOpen(isOpen ? -1 : i)}
              className="rounded-[20px] border border-line bg-white px-6 py-5 text-right"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-[17px] font-semibold">{f.q}</span>
                <span className="text-xl text-violet">{isOpen ? "−" : "+"}</span>
              </div>
              {isOpen ? (
                <p className="mt-3 text-[15px] leading-loose text-muted">{f.a}</p>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
