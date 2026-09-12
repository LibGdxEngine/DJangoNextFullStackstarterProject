"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { UserSessionCard } from "@/features/auth/components/UserSessionCard";
import { AuthShell } from "@/features/auth/components/AuthShell";

export default function AccountPage() {
  const { data: session, status } = useSession();
  const active = session?.backendAuthenticated || session?.sessionUnavailable;
  return (
    <AuthShell title="حسابي" description="يمكنك متابعة حالة حسابك في مبصر من هنا." footer={<Link href="/">العودة إلى الصفحة الرئيسية</Link>}>
      {status === "loading" ? <p role="status" className="py-8 text-center text-sm text-slate-600">جارٍ تحميل الحساب…</p> : active ? (
        <div className="space-y-5"><UserSessionCard /><div className="rounded-xl border border-teal-100 bg-teal-50 p-4"><h2 className="font-bold text-teal-950">استخراج النص العربي</h2><p className="mt-1 text-sm leading-7 text-teal-900">واجهة رفع الصور واستخراج النص قيد التجهيز. سيظهر الوصول إليها هنا عند توفرها.</p></div></div>
      ) : (
        <div className="space-y-4 text-center"><p className="text-slate-700">سجّل الدخول لعرض حسابك.</p>{session?.sessionExpired && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">انتهت جلستك السابقة.</p>}<Link href="/login" className="inline-flex rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white">تسجيل الدخول</Link></div>
      )}
    </AuthShell>
  );
}
