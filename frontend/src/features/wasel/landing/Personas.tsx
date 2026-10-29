import { SectionHeading } from "@/features/wasel/ui/SectionHeading";
import { personas } from "@/features/wasel/data";

export function Personas() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-10 md:px-8">
      <SectionHeading
        eyebrow="وأكثر من المبيعات"
        title={
          <>
            الفريق نفسه،
            <br />
            <span className="text-violet">لأي عمل آخر لديك.</span>
          </>
        }
        description="عروض تقديمية، فيديوهات، أبحاث، وإدارة صفحات — إن كنت تستطيع كتابة رسالة، فبإمكانك تشغيل واصل."
      />

      <div className="mt-11 grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4">
        {personas.map((p) => (
          <a
            key={p.who}
            href="/signup"
            className="flex min-h-[220px] flex-col gap-4 rounded-[26px] p-[26px] transition-transform hover:-translate-y-0.5"
            style={{ background: p.bg }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xl font-bold">{p.who}</span>
              <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-semibold">
                {p.out}
              </span>
            </div>
            <div className="flex-1 text-[17px] leading-relaxed">«{p.ask}»</div>
            <div className="text-[13px] text-[#4A4560]">{p.does}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
