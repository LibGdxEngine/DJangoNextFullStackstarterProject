import Image from "next/image";
import { SiteHeader } from "@/features/wasel/layout/SiteHeader";
import { Button } from "@/features/wasel/ui/Button";
import { TypewriterPrompt } from "@/features/wasel/ui/TypewriterPrompt";
import { heroChips, heroLive, heroPrompts } from "@/features/wasel/data";

export function Hero() {
  return (
    <section
      className="relative overflow-hidden bg-ink text-white"
      style={{
        backgroundImage:
          "radial-gradient(900px 500px at 50% 105%, rgba(109,59,245,.55), transparent 70%), radial-gradient(500px 300px at 85% 10%, rgba(255,181,71,.10), transparent 70%)",
      }}
    >
      <SiteHeader variant="dark" />

      <div className="mx-auto max-w-[980px] px-6 pt-10 text-center md:px-8 md:pt-16">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 py-1.5 pr-3.5 pl-1.5 text-[13px] text-[#C9C4DE]">
          <span className="flex items-center gap-1.5 rounded-full bg-violet px-2.5 py-0.5 font-medium text-white">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            ٦ موظفين متصلون الآن
          </span>
          يعملون عبر ٢,٤٠٠ متصفح حقيقي
        </div>

        <h1 className="mt-7 text-5xl font-bold leading-[1.12] tracking-tight text-balance md:text-7xl">
          كلّفه بأي عمل،
          <br />
          <span className="bg-gradient-to-l from-[#FFB547] via-[#C9A7FF] to-[#8B63FF] bg-clip-text text-transparent">
            وسينجزه لك.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-[720px] text-lg leading-relaxed text-[#C9C4DE] text-pretty md:text-xl">
          واصل موظف ذكاء اصطناعي يعمل في متصفح حقيقي مثل الإنسان تمامًا: يجد العملاء ويتواصل معهم،
          ويدير صفحاتك وحملاتك، ويقدّم على الوظائف، ويُعدّ العروض والتقارير. اكتب ما تريد، وهو ينفّذه من
          البداية إلى النهاية.
        </p>

        <div className="mx-auto mt-10 max-w-[820px] rounded-[28px] border border-white/15 bg-white/5 p-5 pb-4 text-right backdrop-blur-md">
          <div className="min-h-14 text-lg leading-relaxed text-[#E8E4F7]">
            جرّب: <TypewriterPrompt phrases={heroPrompts} className="text-white" />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5 rounded-full bg-black/25 p-1">
              <span className="whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink">
                ⚡ إنجاز
              </span>
              <span className="whitespace-nowrap rounded-full px-4 py-2 text-sm text-[#C9C4DE]">
                ↻ متابعة مستمرة
              </span>
            </div>
            <Button href="/signup" variant="violet" size="md">
              ابدأ مع واصل ←
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {heroChips.map((chip) => (
            <span
              key={chip}
              className="cursor-pointer whitespace-nowrap rounded-full border border-white/15 px-3.5 py-1.5 text-[13px] text-[#E8E4F7] hover:border-amber hover:text-white"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-14 grid max-w-[1100px] grid-cols-[repeat(auto-fit,minmax(min(100%,195px),1fr))] gap-3 px-6 pb-18 md:px-8">
        {heroLive.map((person) => (
          <div
            key={person.name}
            className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/5 p-3.5 text-right"
          >
            <div className="relative flex-shrink-0">
              <Image
                src={person.img}
                alt=""
                width={52}
                height={52}
                className="h-[52px] w-[52px] rounded-full object-cover object-[50%_25%]"
              />
              <span className="absolute bottom-0.5 left-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-ink bg-[#4ADE80]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">
                {person.name} <span className="text-xs font-normal text-[#9A93C0]">· {person.role}</span>
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-[#C9C4DE]">{person.doing}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
