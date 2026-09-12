import Link from "next/link";
import { RegisterForm } from "@/features/auth/components/RegisterForm";
import { AuthShell } from "@/features/auth/components/AuthShell";

export default function RegisterPage() {
  return <AuthShell title="إنشاء حساب" description="أنشئ حسابك، ثم أكّد رقم الهاتف بالرمز المرسل عبر واتساب." footer={<>لديك حساب بالفعل؟ <Link href="/login">سجّل الدخول</Link></>}><RegisterForm /></AuthShell>;
}
