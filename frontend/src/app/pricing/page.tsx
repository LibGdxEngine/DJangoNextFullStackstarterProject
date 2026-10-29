import type { Metadata } from "next";
import { SiteHeader } from "@/features/wasel/layout/SiteHeader";
import { Footer } from "@/features/wasel/layout/Footer";
import { Button } from "@/features/wasel/ui/Button";
import { Faq } from "@/features/wasel/landing/Faq";
import { pricingPlans } from "@/features/wasel/data";

export const metadata: Metadata = { title: "الأسعار" };

export default function PricingPage() {
  return (
    <>
      <SiteHeader variant="light" />
      <main className="mx-auto max-w-[1100px] px-6 py-20 md:px-8">
        <div className="text-center">
          <div className="text-sm font-semibold text-violet">الأسعار</div>
          <h1 className="mt-3.5 text-4xl font-bold leading-tight md:text-5xl">
            ابدأ مجانًا، ووسّع فريقك متى شئت.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted">
            كل باقة تمنحك موظفين ذكاء اصطناعي ورصيدًا شهريًا لتنفيذ المهام. يمكنك الترقية أو التراجع في
            أي وقت.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {pricingPlans.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col gap-6 rounded-[28px] border p-8 ${
                plan.highlighted ? "border-violet bg-ink text-white" : "border-line bg-white"
              }`}
            >
              {plan.highlighted ? (
                <span className="self-start rounded-full bg-amber px-3 py-1 text-xs font-semibold text-ink">
                  الأكثر اختيارًا
                </span>
              ) : null}
              <div>
                <div className={`text-lg font-bold ${plan.highlighted ? "text-white" : "text-ink"}`}>
                  {plan.name}
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className={plan.highlighted ? "text-[#C9C4DE]" : "text-muted"}>
                    {plan.period}
                  </span>
                </div>
                <p className={`mt-3 text-sm leading-relaxed ${plan.highlighted ? "text-[#C9C4DE]" : "text-muted"}`}>
                  {plan.tagline}
                </p>
              </div>

              <ul className="flex flex-col gap-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className={plan.highlighted ? "text-amber" : "text-success"}>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                href="/signup"
                variant={plan.highlighted ? "amber" : "outline"}
                className="mt-auto w-full"
              >
                {plan.id === "scale" ? "تواصل معنا" : "ابدأ الآن"}
              </Button>
            </div>
          ))}
        </div>
      </main>
      <Faq />
      <Footer />
    </>
  );
}
