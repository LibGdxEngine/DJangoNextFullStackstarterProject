"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/features/wasel/ui/Button";
import { Field, authInputClass, AuthError } from "./AuthShell";

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier || !password) {
      setError("من فضلك أدخل البريد الإلكتروني أو رقم الهاتف وكلمة المرور.");
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      const result = await signIn("credentials", { redirect: false, identifier, password });
      if (result?.error) {
        setError(
          result.error.includes("PHONE_VERIFICATION_REQUIRED")
            ? "يجب تأكيد رقم هاتفك أولًا. أنشئ الحساب من جديد أو أكمل التأكيد من صفحة التسجيل."
            : "بيانات الدخول غير صحيحة. حاول مرة أخرى."
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <AuthError message={error} />
      <Field label="البريد الإلكتروني أو رقم الهاتف">
        <input
          dir="ltr"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@example.com"
          className={authInputClass}
        />
      </Field>
      <Field label="كلمة المرور">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className={authInputClass}
        />
      </Field>

      <div className="flex items-center justify-end text-sm">
        <Link href="/forgot-password" className="font-medium text-violet">
          نسيت كلمة المرور؟
        </Link>
      </div>

      <Button type="submit" variant="violet" size="md" className="mt-1 w-full" disabled={loading}>
        {loading ? "جارٍ الدخول…" : "دخول ←"}
      </Button>
    </form>
  );
}
