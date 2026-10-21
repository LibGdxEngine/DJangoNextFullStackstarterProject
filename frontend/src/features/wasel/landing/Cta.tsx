import { Button } from "@/features/wasel/ui/Button";

export function Cta() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-24 md:px-8">
      <div
        className="flex flex-col items-center justify-between gap-8 rounded-[36px] p-10 text-center text-white md:flex-row md:p-16 md:text-right"
        style={{ background: "linear-gradient(135deg,#6D3BF5,#4F22D1)" }}
      >
        <div>
          <h2 className="text-[46px] font-bold leading-tight">موظفك الأول علينا.</h2>
          <p className="mt-3.5 text-lg text-[#E8E0FF]">ابدأ بموظف واحد مجانًا، ووسّع فريقك متى شئت.</p>
        </div>
        <Button href="/signup" variant="amber" size="lg">
          وظّف موظفك الأول ←
        </Button>
      </div>
    </section>
  );
}
