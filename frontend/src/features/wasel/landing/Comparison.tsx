import { compareRows } from "@/features/wasel/data";

export function Comparison() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-10 md:px-8">
      <div className="overflow-hidden rounded-[32px] border border-line bg-white">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] bg-paper text-sm font-semibold">
          <div className="px-7 py-5">المقارنة</div>
          <div className="px-7 py-5 text-muted">موظف تقليدي</div>
          <div className="bg-violet px-7 py-5 text-white">واصل</div>
        </div>
        {compareRows.map((row) => (
          <div
            key={row.k}
            className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] border-t border-[#EEEAF5] text-[15px]"
          >
            <div className="px-7 py-[18px] font-semibold">{row.k}</div>
            <div className="px-7 py-[18px] text-muted">{row.a}</div>
            <div className="bg-[#FAF8FF] px-7 py-[18px] font-semibold text-[#4F22D1]">{row.b}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
