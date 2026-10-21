import Image from "next/image";
import { Button } from "@/features/wasel/ui/Button";

export function MorningReport() {
  return (
    <section className="bg-ink text-white">
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-16 px-6 py-24 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div>
          <div className="text-sm font-semibold text-amber">التقرير الصباحي</div>
          <h2 className="mt-3.5 text-4xl font-bold leading-tight md:text-[56px]">
            يعمل أثناء نومك.
            <br />
            <span className="text-[#C9A7FF]">وتستيقظ على النتائج.</span>
          </h2>
          <p className="mt-[22px] max-w-[520px] text-lg leading-loose text-[#C9C4DE]">
            في الثامنة صباحًا يرسل إليك كل موظف رسالة واحدة عبر واتساب أو تيليجرام: ماذا أنجز، وماذا
            تعلّم، وما الذي يحتاجه منك. وإن لم يكن هناك جديد، فلن يزعجك.
          </p>
        </div>

        <div
          className="rounded-[28px] bg-white p-[22px] text-ink"
          style={{ boxShadow: "0 30px 80px rgba(109,59,245,.35)" }}
        >
          <div className="flex items-center gap-3 border-b border-[#EEE] pb-4">
            <Image
              src="/agents/finance.png"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 rounded-full object-cover"
            />
            <div>
              <div className="font-semibold">هشام · المالية والتقارير</div>
              <div className="text-xs text-muted">واتساب · ٨:٠٠ ص</div>
            </div>
          </div>
          <div className="pt-3.5 text-[15px] leading-loose">
            <div>
              <b>صباح الخير ☀️</b> مبيعات الأمس ١٨٤ ألفًا — أعلى من متوسط الأسبوع بنسبة ١٢٪.
            </div>
            <div className="mt-2">
              <b className="text-violet">لاحظت:</b> مخزون المنتج رقم ٤٧ سينفد خلال ٣ أيام.
            </div>
            <div className="mt-2">
              <b className="text-violet">عملت:</b> جهّزت طلب توريد بانتظار موافقتك.
            </div>
            <div className="mt-2">
              <b className="text-[#B7791F]">أحتاج منك:</b> موافقة على فاتورة المورّد.
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="violet" size="sm">موافق</Button>
            <button className="rounded-full bg-[#F2F0F8] px-4 py-2.5 text-sm">اعرض التفاصيل</button>
          </div>
        </div>
      </div>
    </section>
  );
}
