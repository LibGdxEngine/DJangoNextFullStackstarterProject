"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { AuthShell } from "@/features/auth/components/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const active = session?.backendAuthenticated || session?.sessionUnavailable;

  return (
    <AuthShell title="تسجيل الدخول" description="ادخل إلى حسابك في مبصر باستخدام بريدك الإلكتروني أو رقم هاتفك." footer={<>ليس لديك حساب؟ <Link href="/register">أنشئ حسابًا</Link></>}>
      {status === "loading" ? <p role="status" className="py-8 text-center text-sm text-slate-600">جارٍ التحقق من الجلسة…</p> : active ? (
        <div className="space-y-4 text-center"><p className="text-slate-700">أنت مسجل الدخول بالفعل.</p><Link href="/account" className="inline-flex rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white">الانتقال إلى حسابي</Link></div>
      ) : (
        <>
          {session?.sessionExpired && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">انتهت جلستك. سجّل الدخول مرة أخرى.</p>}
          <LoginForm onSuccess={() => { router.replace("/account"); router.refresh(); }} />
        </>
      )}
    </AuthShell>
  );
}
