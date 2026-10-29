import { SectionHeading } from "@/features/wasel/ui/SectionHeading";

const STEPS = [
  {
    n: "١",
    title: "اكتب طلبك",
    dark: false,
    preview: "«أريد ٣٠ عيادة أسنان في مدينة نصر، وأرسل لكل منها عرض نظام الحجز الإلكتروني.»",
    text: "بلغتك العادية. يمكنك إرفاق ملف أو رابط أو صورة لتوضيح ما تريد.",
  },
  {
    n: "٢",
    title: "راجِع الخطة",
    dark: false,
    list: [
      "البحث في خرائط جوجل عن عيادات الأسنان",
      "التحقق من الأرقام وحسابات التواصل",
      "إرسال رسالة مخصصة لكل عيادة",
    ],
    text: "يكتب واصل خطة واضحة قبل أي تنفيذ. تعدّل ما تريد، ثم توافق.",
  },
  {
    n: "٣",
    title: "استلم النتيجة",
    dark: true,
    stats: [
      { label: "عيادات تم الوصول إليها", value: "٣٠" },
      { label: "ردود حتى الآن", value: "٩", color: "#4ADE80" },
      { label: "اجتماعات محجوزة", value: "٣", color: "#FFB547" },
    ],
    text: "تتابع العمل مباشرة، وتصلك النتيجة في المحادثة وعلى واتساب.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <SectionHeading
        align="between"
        eyebrow="كيف يعمل"
        title="ثلاث خطوات، دون أي إعداد تقني."
        description="لا تحتاج إلى برمجة أو ربط معقّد. تكتب ما تريد كما تكتبه لزميل، والباقي على واصل."
      />

      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-5">
        {STEPS.map((step) => (
          <div
            key={step.n}
            className={`flex flex-col gap-[18px] rounded-[28px] p-7 ${
              step.dark ? "bg-ink text-white" : "border border-line bg-white"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold ${
                  step.dark ? "bg-amber text-ink" : "bg-violet-tint text-violet"
                }`}
              >
                {step.n}
              </span>
              <span className="text-[22px] font-bold">{step.title}</span>
            </div>

            {step.preview ? (
              <div className="rounded-[18px] bg-paper p-4 text-[15px] leading-relaxed">
                {step.preview}
              </div>
            ) : null}

            {step.list ? (
              <div className="flex flex-col gap-2 rounded-[18px] bg-paper p-4 text-sm">
                {step.list.map((item, i) => (
                  <div key={item} className="flex gap-2">
                    <b className="text-violet">{i + 1}</b>
                    {item}
                  </div>
                ))}
              </div>
            ) : null}

            {step.stats ? (
              <div className="flex flex-col gap-2 rounded-[18px] bg-white/[0.07] p-4 text-sm">
                {step.stats.map((s) => (
                  <div key={s.label} className="flex justify-between">
                    <span>{s.label}</span>
                    <b style={{ color: s.color }}>{s.value}</b>
                  </div>
                ))}
              </div>
            ) : null}

            <p className={`text-[15px] leading-relaxed ${step.dark ? "text-[#C9C4DE]" : "text-muted"}`}>
              {step.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
