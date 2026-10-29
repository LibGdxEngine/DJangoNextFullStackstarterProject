import Image from "next/image";
import { SectionHeading } from "@/features/wasel/ui/SectionHeading";
import { Button } from "@/features/wasel/ui/Button";
import { agents } from "@/features/wasel/data";

export function TeamPreview() {
  return (
    <section id="team" className="mx-auto max-w-[1240px] px-6 py-20 md:px-8">
      <SectionHeading
        align="between"
        eyebrow="تعرّف على الفريق"
        title="لكل مهمة متخصص."
        description={
          <Button href="/dashboard/team" variant="outline">
            اعرض الفريق كاملًا ←
          </Button>
        }
      />

      <div className="relative mt-10 overflow-hidden rounded-[32px] bg-ink">
        <Image
          src="/agents/team.png"
          alt="فريق واصل من موظفي الذكاء الاصطناعي"
          width={1400}
          height={781}
          className="h-auto w-full object-cover"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {agents.map((agent) => (
          <div key={agent.id} className="overflow-hidden rounded-[28px] border border-line bg-white">
            <div className="aspect-[4/3]" style={{ background: agent.tint }}>
              <Image src={agent.img} alt={agent.name} width={320} height={240} className="h-full w-full object-cover" />
            </div>
            <div className="p-5 pb-6">
              <div className="text-[13px] font-semibold text-violet">{agent.role}</div>
              <div className="mt-1.5 text-[22px] font-bold">{agent.name}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{agent.line}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
