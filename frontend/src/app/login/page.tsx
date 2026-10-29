import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/features/wasel/auth/AuthShell";
import { LoginForm } from "@/features/wasel/auth/LoginForm";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default function LoginPage() {
  return (
    <AuthShell
      title="تسجيل الدخول"
      subtitle="أهلًا بعودتك. سجّل الدخول لمتابعة العمل مع فريقك."
      footer={
        <>
          ليس لديك حساب؟{" "}
          <Link href="/signup" className="font-semibold text-white">
            أنشئ حسابًا مجانًا
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
