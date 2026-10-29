"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/features/wasel/ui/Button";
import { accountsApi } from "@/lib/api/accounts";
import { describeApiError } from "@/lib/api/errors";
import { Field, authInputClass, AuthError } from "./AuthShell";

type Step = "identify" | "verify" | "reset" | "done";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string>();
  const [resetToken, setResetToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    setLoading(true);
    try {
      await action();
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setLoading(false);
    }
  }

  function handleIdentify(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier) {
      setError("من فضلك أدخل بريدك الإلكتروني أو رقم هاتفك.");
      return;
    }
    void run(async () => {
      const response = await accountsApi.forgotPassword({ identifier });
      setChallengeId(response.challenge_id);
      setStep("verify");
    });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!code) {
      setError("أدخل الرمز الذي وصلك.");
      return;
    }
    if (!challengeId) {
      setError("لم نجد حسابًا بهذه البيانات.");
      return;
    }
    void run(async () => {
      const response = await accountsApi.verifyPasswordReset({ challenge_id: challengeId, code });
      setResetToken(response.reset_token);
      setStep("reset");
    });
  }

  function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("كلمة المرور يجب أن تكون ٨ أحرف على الأقل.");
      return;
    }
    if (!resetToken) return;
    void run(async () => {
      await accountsApi.resetPassword({ reset_token: resetToken, new_password: password });
      setStep("done");
    });
  }

  if (step === "done") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <div className="text-4xl">✅</div>
        <p className="text-[15px] leading-relaxed text-muted">تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.</p>
        <Button variant="violet" size="md" className="w-full" onClick={() => router.push("/login")}>
          تسجيل الدخول
        </Button>
      </div>
    );
  }

  if (step === "reset") {
    return (
      <form onSubmit={handleReset} className="flex flex-col gap-4">
        <AuthError message={error} />
        <Field label="كلمة المرور الجديدة">
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="٨ أحرف على الأقل"
            className={authInputClass}
          />
        </Field>
        <Button type="submit" variant="violet" size="md" className="mt-1 w-full" disabled={loading}>
          {loading ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
        </Button>
      </form>
    );
  }

  if (step === "verify") {
    return (
      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        <AuthError message={error} />
        <p className="text-sm leading-relaxed text-muted">
          إذا كان الحساب مسجّلًا لدينا، فقد أرسلنا إليه رمزًا. أدخله هنا.
        </p>
        <Field label="رمز التأكيد">
          <input
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder="123456"
            className={authInputClass}
          />
        </Field>
        <Button type="submit" variant="violet" size="md" className="mt-1 w-full" disabled={loading}>
          {loading ? "جارٍ التحقق…" : "تحقق"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleIdentify} className="flex flex-col gap-4">
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
      <Button type="submit" variant="violet" size="md" className="mt-1 w-full" disabled={loading}>
        {loading ? "جارٍ الإرسال…" : "أرسل رمز إعادة التعيين"}
      </Button>
    </form>
  );
}
