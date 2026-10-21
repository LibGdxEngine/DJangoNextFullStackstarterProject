import type { Metadata } from "next";
import Image from "next/image";
import { agents } from "@/features/wasel/data";

export const metadata: Metadata = { title: "فريقك" };

export default function TeamPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 md:px-8">
      <h1 className="text-4xl font-bold">فريقك</h1>
      <p className="mt-2.5 text-base text-muted">
        لكل موظف هوية ومتصفح وذاكرة خاصة. كلّف من تشاء مباشرة، أو دع واصل يختار.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="grid grid-cols-[160px_minmax(0,1fr)] overflow-hidden rounded-[28px] border border-line bg-white"
          >
            <div style={{ background: agent.tint }}>
              <Image src={agent.img} alt={agent.name} width={160} height={200} className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col gap-2.5 p-[22px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-violet">{agent.role}</span>
                <span className="text-xs" style={{ color: agent.statusColor }}>
                  ● {agent.status}
                </span>
              </div>
              <div className="text-2xl font-bold">{agent.name}</div>
              <div className="text-sm leading-relaxed text-muted">{agent.line}</div>
              <div className="flex flex-wrap gap-1.5">
                {agent.skills.map((skill) => (
                  <span key={skill} className="rounded-full bg-[#F2F0F8] px-2.5 py-1 text-xs">
                    {skill}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex gap-2 pt-1.5">
                <a
                  href="/dashboard"
                  className="whitespace-nowrap rounded-full bg-ink px-[18px] py-2.5 text-sm font-semibold text-white hover:bg-violet"
                >
                  كلّف {agent.name} ←
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-5 rounded-[28px] border-[1.5px] border-dashed border-[#CFC6EA] p-7">
        <div>
          <div className="text-xl font-bold">تحتاج دورًا غير موجود؟</div>
          <div className="mt-1.5 text-sm text-muted">
            مصمم، مدرّب، باحث، محاسب — صِف الدور وسيجهّز واصل موظفًا بهذه المهارات.
          </div>
        </div>
        <button className="whitespace-nowrap rounded-full bg-amber px-[22px] py-3 text-[15px] font-semibold">
          ＋ وظّف دور جديد
        </button>
      </div>
    </div>
  );
}
