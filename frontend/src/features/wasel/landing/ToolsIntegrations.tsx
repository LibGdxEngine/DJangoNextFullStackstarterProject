import { tools } from "@/features/wasel/data";

export function ToolsIntegrations() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-12">
        <div className="lg:sticky lg:top-10">
          <div className="text-sm font-semibold text-violet">يعمل مع أدواتك</div>
          <h2 className="mt-3.5 text-[46px] font-bold leading-tight">
            أي موقع تفتحه أنت،
            <br />
            يستطيع واصل العمل عليه.
          </h2>
          <p className="mt-[18px] text-[17px] leading-relaxed text-muted">
            لأنه يعمل عبر متصفح حقيقي، لا يحتاج إلى ربط تقني. تسجّل الدخول مرة واحدة، ويبدأ العمل على
            أنظمتك كما يعمل أي موظف جديد.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {tools.map((t) => (
            <div key={t.name} className="flex flex-col gap-1 rounded-[18px] border border-line bg-white p-4">
              <span dir="ltr" className="text-right text-[15px] font-bold">
                {t.name}
              </span>
              <span className="text-xs text-muted-soft">{t.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
