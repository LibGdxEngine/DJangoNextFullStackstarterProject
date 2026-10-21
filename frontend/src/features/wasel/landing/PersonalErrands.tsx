import { errands, applications } from "@/features/wasel/data";

export function PersonalErrands() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-center gap-10">
        <div>
          <div className="text-sm font-semibold text-violet">لك أنت أيضًا</div>
          <h2 className="mt-3.5 text-4xl font-bold leading-tight md:text-5xl">
            يقدّم عنك على الوظائف،
            <br />
            <span className="text-violet">وينجز أعمالك الشخصية.</span>
          </h2>
          <p className="mt-[18px] text-[17px] leading-relaxed text-muted">
            ارفع سيرتك الذاتية مرة واحدة، وحدّد الوظيفة التي تريدها. يبحث واصل في مواقع التوظيف، ويكتب
            خطاب تقديم مخصصًا لكل وظيفة، ويملأ النماذج، ويتابع الردود حتى تصل إلى المقابلة.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {errands.map((e) => (
              <span key={e} className="whitespace-nowrap rounded-full border border-line bg-white px-3.5 py-2 text-sm">
                {e}
              </span>
            ))}
          </div>
        </div>

        <div
          className="rounded-[28px] border border-line bg-white p-6"
          style={{ boxShadow: "0 30px 60px rgba(14,11,31,.06)" }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#EEEAF5] pb-4">
            <div>
              <div className="text-[17px] font-bold">طلبات التوظيف</div>
              <div className="mt-0.5 text-[13px] text-muted">مصمم UI · القاهرة أو عن بُعد</div>
            </div>
            <span className="whitespace-nowrap rounded-full bg-[#DCFCE7] px-3 py-1.5 text-xs font-semibold text-[#15803D]">
              ٢١ طلبًا مُرسلًا
            </span>
          </div>
          <div className="mt-2.5 flex flex-col gap-1">
            {applications.map((a) => (
              <div key={a.company} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F2F0F8] text-[13px] font-bold">
                  {a.initials}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{a.company}</div>
                  <div className="text-xs text-muted-soft">{a.source}</div>
                </div>
                <span
                  className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{ background: a.bg, color: a.fg }}
                >
                  {a.status}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-2xl bg-violet-tint p-4 text-sm leading-relaxed text-[#3B1E9E]">
            <b>تنبيه:</b> مقابلة مع «فوري» يوم الأحد ١١ صباحًا — جهّزت لك ملخصًا عن الشركة وأسئلة متوقعة.
          </div>
        </div>
      </div>
    </section>
  );
}
