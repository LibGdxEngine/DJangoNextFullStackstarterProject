import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/features/wasel/auth/AuthShell";
import { SignupForm } from "@/features/wasel/auth/SignupForm";

export const metadata: Metadata = { title: "إنشاء حساب" };

export default function SignupPage() {
  return (
    <AuthShell
      title="موظفك الأول علينا"
      subtitle="أنشئ حسابًا مجانيًا وابدأ تكليف واصل في دقائق."
      footer={
        <>
          لديك حساب؟{" "}
          <Link href="/login" className="font-semibold text-white">
            سجّل الدخول
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
