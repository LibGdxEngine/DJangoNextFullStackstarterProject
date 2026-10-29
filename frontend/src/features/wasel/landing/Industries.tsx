import { industries } from "@/features/wasel/data";

export function Industries() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-20 md:px-8">
      <div className="text-sm font-semibold text-violet">حسب مجالك</div>
      <h2 className="mt-3.5 mb-9 text-[46px] font-bold leading-tight">ماذا يفعل واصل في نشاطك؟</h2>
      <div className="border-t border-line">
        {industries.map((d) => (
          <div
            key={d.name}
            className="grid grid-cols-1 gap-3 border-b border-line py-6 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:items-baseline md:gap-6"
          >
            <span className="text-[22px] font-bold">{d.name}</span>
            <span className="text-base leading-relaxed text-[#4A4560]">{d.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
