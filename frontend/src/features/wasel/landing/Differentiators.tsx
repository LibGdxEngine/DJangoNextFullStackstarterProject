import { SectionHeading } from "@/features/wasel/ui/SectionHeading";

export function Differentiators() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <SectionHeading
        eyebrow="الفرق الحقيقي"
        title={
          <>
            ليس روبوت محادثة.
            <br />
            <span className="text-violet">بل زميل يُنجز العمل.</span>
          </>
        }
        description="حدّد النتيجة التي تريدها، وواصل يفتح المتصفح، ويسجّل الدخول، ويبحث، ويكتب، ويصمّم، ثم يعود إليك بعمل جاهز للاستخدام."
      />

      <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="grid grid-cols-1 gap-7 rounded-[28px] border border-line bg-white p-8 md:col-span-2 md:grid-cols-2 md:items-center">
          <div>
            <div className="text-[13px] text-muted">٠١</div>
            <h3 className="mt-2.5 text-[28px] font-bold">متصفح حقيقي باسمك</h3>
            <p className="mt-3 text-base leading-relaxed text-muted">
              يستخدم المواقع والحسابات نفسها التي تستخدمها — لينكدإن، جوجل، واتساب، كانفا — ويعمل كما
              يعمل أي موظف، ويمكنك مشاهدته أثناء العمل.
            </p>
          </div>
          <div className="rounded-[20px] bg-ink p-3.5 text-white">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B6B]" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#4ADE80]" />
              <span
                dir="ltr"
                className="mr-2.5 flex-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-left text-[11px] text-[#C9C4DE]"
              >
                linkedin.com/search/companies
              </span>
            </div>
            <div className="mt-3.5 flex flex-col gap-2 text-[13px]">
              <div className="flex items-center gap-2.5">
                <span className="text-[#4ADE80]">✓</span>بحثت عن الشركات — عقارات، القاهرة الجديدة
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[#4ADE80]">✓</span>جمعت ٣٨ شركة واستبعدت ٦ مكررات
              </div>
              <div className="flex items-center gap-2.5 text-amber">
                <span>●</span>أدوّن البيانات في Google Sheets…
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-6 rounded-[28px] bg-violet p-8 text-white">
          <div className="flex flex-wrap gap-2">
            {["HubSpot", "Odoo", "Meta Ads", "QuickBooks"].map((t) => (
              <span key={t} className="rounded-full bg-white/15 px-3 py-1.5 text-[13px]">
                {t}
              </span>
            ))}
            <span className="rounded-full bg-amber px-3 py-1.5 text-[13px] font-semibold text-ink">
              + أي نظام
            </span>
          </div>
          <div>
            <div className="text-[13px] text-[#DCD0FF]">٠٢</div>
            <h3 className="mt-2.5 text-[28px] font-bold">يعمل على أي نظام</h3>
            <p className="mt-3 text-base leading-relaxed text-[#E8E0FF]">
              يراقب الأرقام على مدار الساعة، وينبّهك لأي خلل قبل أن تكتشفه.
            </p>
          </div>
        </div>

        <div className="rounded-[28px] border border-line bg-white p-8">
          <div className="text-[13px] text-muted">٠٣</div>
          <h3 className="mt-2.5 text-2xl font-bold">يسلّم نتائج لا وعودًا</h3>
          <p className="mt-3 text-base leading-relaxed text-muted">
            قائمة عملاء، صفقات محجوزة، حملة تعمل، تقرير جاهز.
          </p>
        </div>

        <div className="rounded-[28px] border border-line bg-white p-8">
          <div className="text-[13px] text-muted">٠٤</div>
          <h3 className="mt-2.5 text-2xl font-bold">ذاكرة لا تنسى</h3>
          <p className="mt-3 text-base leading-relaxed text-muted">
            يتذكر كل عميل تواصل معه، ويكمل دائمًا من حيث توقف.
          </p>
        </div>

        <div className="rounded-[28px] border border-[#FBE3BC] bg-[#FFF4E2] p-8">
          <div className="text-[13px] text-[#9A6A1F]">٠٥</div>
          <h3 className="mt-2.5 text-2xl font-bold">القرار لك</h3>
          <p className="mt-3 text-base leading-relaxed text-[#7A5A2A]">
            أوقفه، أو استأنف عمله، أو عدّل الخطة بجملة واحدة.
          </p>
        </div>
      </div>
    </section>
  );
}
