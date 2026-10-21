import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Horizontal stepper; collapses to "Step n of m · Title" on narrow screens. */
export function Stepper({ steps, current, label, stepOf }: { steps: string[]; current: number; label: string; stepOf: (n: number, total: number) => string }) {
  return (
    <nav aria-label={label}>
      <p className="text-[13px] font-medium text-secondary sm:hidden">
        {stepOf(current + 1, steps.length)} · <span className="text-ink">{steps[current]}</span>
      </p>
      <ol className="hidden items-center text-xs sm:flex">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step} className={cn("flex items-center", i < steps.length - 1 && "flex-1")} aria-current={active ? "step" : undefined}>
              <span className="flex items-center gap-2">
                <span className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-semibold",
                  done || active ? "bg-brand-800 text-white" : "border-2 border-line text-muted",
                )}>
                  {done ? <Check aria-hidden className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn(active ? "font-semibold text-ink" : done ? "font-medium text-brand-800" : "text-muted")}>{step}</span>
              </span>
              {i < steps.length - 1 && <span aria-hidden className={cn("mx-2.5 h-0.5 flex-1", done ? "bg-brand-800" : "bg-line")} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
