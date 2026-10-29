import Image from "next/image";
import { milestones } from "@/features/wasel/data";

export function GoalsVsTasks() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-20 md:px-8">
      <div className="text-center">
        <h2 className="text-4xl font-bold leading-tight md:text-5xl">
          بعض الأعمال تُنجز مرة واحدة،
          <br />
          <span className="text-violet">وبعضها يحتاج متابعة مستمرة.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted">
          اختر «إنجاز» لعمل يُنفّذ مرة واحدة، أو «متابعة مستمرة» لهدف يحتاج عملًا يوميًا — عدد اجتماعات،
          أو نمو في المبيعات، أو عملاء جدد — ويواصل العمل حتى يتحقق.
        </p>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 rounded-[32px] border border-line bg-white p-9 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <span className="self-start rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-amber">
            ↻ متابعة مستمرة
          </span>
          <div className="text-[22px] font-bold leading-relaxed">احجز ٢٠ اجتماع مبيعات خلال ٣٠ يومًا</div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-7xl font-bold leading-none">١٤</span>
            <span className="text-muted">من ٢٠ اجتماعًا</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-violet-tint">
            <div className="h-full w-[70%] rounded-full bg-gradient-to-l from-[#8B63FF] to-violet" />
          </div>
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <Image
              src="/agents/sales.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-full object-cover"
            />
            سلمى تعمل عليه · اليوم ٢١
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          {milestones.map((m) => (
            <div
              key={m.day}
              className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4 rounded-[18px] px-[18px] py-3.5"
              style={{ background: m.active ? "#EEE8FF" : "#F7F6FB" }}
            >
              <span className="text-[13px] text-muted">يوم {m.day}</span>
              <span className="text-base font-medium">{m.text}</span>
              <span
                className="text-[13px] font-semibold"
                style={{ color: m.done ? "#16A34A" : m.active ? "#6D3BF5" : "#9A97AB" }}
              >
                {m.tag}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
