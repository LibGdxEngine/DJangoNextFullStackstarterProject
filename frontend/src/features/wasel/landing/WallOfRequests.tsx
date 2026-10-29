import { SectionHeading } from "@/features/wasel/ui/SectionHeading";
import { wall } from "@/features/wasel/data";

export function WallOfRequests() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <SectionHeading
        eyebrow="اطلب منه أي شيء"
        title={
          <>
            كل ما تفعله على الإنترنت،
            <br />
            <span className="text-violet">يستطيع واصل فعله عنك.</span>
          </>
        }
        description="يفتح المواقع، ويسجّل الدخول، ويبحث، ويكتب، ويرسل، ويحجز — كما تفعل أنت تمامًا. هذه بعض الأشياء التي يطلبها الناس منه كل يوم:"
      />

      <div className="mt-11 grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-3">
        {wall.map((item, i) => (
          <a
            key={i}
            href="/signup"
            className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-white p-5 hover:border-[#B9A3FF]"
          >
            <span
              className="self-start rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: item.bg, color: item.fg }}
            >
              {item.label}
            </span>
            <span className="text-base font-medium leading-relaxed">«{item.text}»</span>
          </a>
        ))}
      </div>
    </section>
  );
}
