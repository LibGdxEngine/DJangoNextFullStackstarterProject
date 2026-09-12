import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f8f6ef] px-6 text-center text-[#102f38]">
      <div>
        <p className="mb-3 text-sm font-bold text-[#08796f]">خطأ ٤٠٤</p>
        <h1 className="mb-4 text-3xl font-extrabold sm:text-5xl">الصفحة غير موجودة</h1>
        <p className="mb-8 text-[#52666c]">تعذّر العثور على الصفحة التي تبحث عنها.</p>
        <Link
          href="/"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#08796f] px-6 font-bold text-white transition hover:bg-[#075e58]"
        >
          العودة إلى الرئيسية
        </Link>
      </div>
    </main>
  );
}
