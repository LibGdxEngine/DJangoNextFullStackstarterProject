import { SectionHeading } from "@/features/wasel/ui/SectionHeading";
import { Badge } from "@/features/wasel/ui/Badge";
import { pipeline } from "@/features/wasel/data";

export function Pipeline() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <SectionHeading
        eyebrow="من أول اسم حتى إتمام الصفقة"
        title={
          <>
            يجد العميل، ويتواصل معه،
            <br />
            <span className="text-violet">ويتابعه حتى يشتري.</span>
          </>
        }
        description="لا يكتفي بتسليمك قائمة أسماء. واصل يبدأ المحادثة، ويجيب عن الأسئلة، ويتابع من لم يرد، ويحجز لك الاجتماع — وكل ذلك موثّق لديك."
      />

      <div className="mt-12 grid grid-cols-2 gap-3 overflow-x-auto pb-1 md:grid-cols-5">
        {pipeline.map((stage) => (
          <div
            key={stage.n}
            className="flex min-h-[200px] flex-col gap-2 rounded-[22px] p-[18px]"
            style={{ background: stage.bg, color: stage.fg }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] opacity-70">{stage.n}</span>
              <span className="text-[28px] font-bold leading-none">{stage.num}</span>
            </div>
            <div className="mt-auto text-[19px] font-bold">{stage.title}</div>
            <div className="text-sm leading-relaxed opacity-80">{stage.desc}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-5">
        <div className="flex flex-col gap-3 rounded-[28px] border border-line bg-white p-6">
          <div className="flex items-center gap-2.5 text-[13px] text-muted">
            <Badge bg="#DCFCE7" fg="#15803D">واتساب</Badge>
            أحمد · مدير مبيعات «بيت الريف للتطوير»
          </div>
          <div className="max-w-[85%] self-start rounded-[18px] rounded-br-sm bg-violet-tint px-4 py-3 text-[15px] leading-relaxed">
            مرحبًا أ. أحمد 👋 اطّلعت على مشروعكم الجديد في التجمع. نساعد شركات التطوير في الوصول إلى
            مشترين جادّين — هل يمكنني إرسال ٣ أمثلة؟
          </div>
          <div className="max-w-[85%] self-end rounded-[18px] rounded-bl-sm bg-[#F2F0F8] px-4 py-3 text-[15px] leading-relaxed">
            تفضّل، لكن أريد معرفة الأسعار أولًا
          </div>
          <div className="max-w-[85%] self-start rounded-[18px] rounded-br-sm bg-violet-tint px-4 py-3 text-[15px] leading-relaxed">
            بالتأكيد، أرسلت لك الملف ✅ هل يناسبك اتصال لمدة ١٥ دقيقة يوم الخميس الساعة ١١ صباحًا؟
          </div>
          <div className="text-[13px] font-semibold text-[#15803D]">
            ✓ تم حجز اجتماع الخميس · وسُجّل في HubSpot
          </div>
        </div>

        <div className="flex flex-col justify-between gap-5 rounded-[28px] bg-ink p-7 text-white">
          <div>
            <div className="text-sm font-semibold text-amber">حاضر في كل القنوات</div>
            <div className="mt-2.5 text-[28px] font-bold leading-relaxed">
              واتساب، لينكدإن، البريد، إنستجرام، واجتماعات تُحجز مباشرة في تقويمك.
            </div>
          </div>
          <div className="flex flex-col gap-2.5 text-[15px] text-[#C9C4DE]">
            <div>✓ لا يرسل الرسالة نفسها إلى العميل مرتين</div>
            <div>✓ يكتب لكل عميل رسالة مخصصة تناسبه</div>
            <div>✓ يخبرك بالعملاء الجاهزين ومن يحتاج تواصلك الشخصي</div>
          </div>
        </div>
      </div>
    </section>
  );
}
