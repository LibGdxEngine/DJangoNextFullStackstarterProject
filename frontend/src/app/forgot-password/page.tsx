import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/features/wasel/auth/AuthShell";
import { ForgotPasswordForm } from "@/features/wasel/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "استعادة كلمة المرور" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="نسيت كلمة المرور؟"
      subtitle="أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة تعيين كلمة المرور."
      footer={
        <>
          تذكّرتها؟{" "}
          <Link href="/login" className="font-semibold text-white">
            رجوع لتسجيل الدخول
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
