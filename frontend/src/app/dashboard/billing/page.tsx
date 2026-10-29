import type { Metadata } from "next";
import { pricingPlans } from "@/features/wasel/data";

export const metadata: Metadata = { title: "الفواتير والرصيد" };

const USAGE_LOG = [
  { label: "جمع عملاء عقارات التجمع", cost: "٥ أرصدة", date: "اليوم" },
  { label: "تقرير Odoo الصباحي", cost: "١ رصيد", date: "أمس" },
  { label: "حملة رمضان — Meta", cost: "٨ أرصدة", date: "منذ ٣ أيام" },
  { label: "رد على رسائل واتساب", cost: "٢ أرصدة", date: "منذ ٤ أيام" },
];

export default function BillingPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-12 md:px-8">
      <h1 className="text-4xl font-bold">الفواتير والرصيد</h1>
      <p className="mt-2.5 text-base text-muted">تابع رصيدك الحالي، وخطتك، وآخر ما استهلكه فريقك.</p>

      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="rounded-[24px] bg-violet-tint p-6">
          <div className="text-sm text-muted">الرصيد الحالي</div>
          <div className="mt-2 text-4xl font-bold">٢٨٨</div>
          <div className="mt-1 text-xs text-muted-soft">يتجدد في ١ من الشهر القادم</div>
        </div>
        <div className="rounded-[24px] border border-line bg-white p-6">
          <div className="text-sm text-muted">الخطة الحالية</div>
          <div className="mt-2 text-2xl font-bold">تجربة مجانية</div>
          <div className="mt-1 text-xs text-muted-soft">موظف ذكاء اصطناعي واحد · ٣٠ رصيد شهريًا</div>
        </div>
        <div className="rounded-[24px] border border-line bg-white p-6">
          <div className="text-sm text-muted">الاستهلاك هذا الشهر</div>
          <div className="mt-2 text-2xl font-bold">١٦ رصيد</div>
          <div className="mt-1 text-xs text-muted-soft">من أصل ٣٠ رصيد</div>
        </div>
      </div>

      <h2 className="mt-14 text-2xl font-bold">ترقية الخطة</h2>
      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
        {pricingPlans.map((plan) => (
          <div
            key={plan.id}
            className={`flex flex-col gap-4 rounded-[24px] border p-6 ${
              plan.highlighted ? "border-violet bg-ink text-white" : "border-line bg-white"
            }`}
          >
            <div className="text-lg font-bold">{plan.name}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className={plan.highlighted ? "text-[#C9C4DE]" : "text-muted"}>{plan.period}</span>
            </div>
            <a
              href="/pricing"
              className={`mt-auto rounded-full px-4 py-2.5 text-center text-sm font-semibold ${
                plan.highlighted ? "bg-amber text-ink" : "border border-line"
              }`}
            >
              التفاصيل
            </a>
          </div>
        ))}
      </div>

      <h2 className="mt-14 text-2xl font-bold">سجل الاستهلاك</h2>
      <div className="mt-6 overflow-hidden rounded-[24px] border border-line bg-white">
        {USAGE_LOG.map((entry, i) => (
          <div
            key={entry.label}
            className={`flex items-center justify-between gap-4 px-6 py-4 ${
              i > 0 ? "border-t border-line" : ""
            }`}
          >
            <div>
              <div className="text-[15px] font-medium">{entry.label}</div>
              <div className="text-xs text-muted-soft">{entry.date}</div>
            </div>
            <span className="whitespace-nowrap text-sm font-semibold text-violet">{entry.cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
