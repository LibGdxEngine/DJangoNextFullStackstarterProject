"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/features/wasel/ui/Button";
import { accountsApi } from "@/lib/api/accounts";
import { describeApiError } from "@/lib/api/errors";
import { Field, authInputClass, AuthError } from "./AuthShell";

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string>();
  const [destination, setDestination] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !phone || !password) {
      setError("من فضلك أكمل جميع الحقول.");
      return;
    }
    if (password.length < 8) {
      setError("كلمة المرور يجب أن تكون ٨ أحرف على الأقل.");
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      const [first, ...rest] = name.trim().split(/\s+/);
      const challenge = await accountsApi.signup({
        email,
        phone,
        password,
        first_name: first ?? "",
        last_name: rest.join(" "),
      });
      setChallengeId(challenge.challenge_id);
      setDestination(challenge.destination);
    } catch (err) {
      const failure = describeApiError(err);
      setError(Object.values(failure.fields)[0] ?? failure.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId || !code) {
      setError("أدخل رمز التأكيد.");
      return;
    }
    setError(undefined);
    setNotice(undefined);
    setLoading(true);
    try {
      await accountsApi.confirmVerification({ challenge_id: challengeId, code });
      const result = await signIn("credentials", { redirect: false, identifier: email, password });
      if (result?.error) {
        router.push("/login");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(describeApiError(err).message);
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!challengeId) return;
    setError(undefined);
    try {
      await accountsApi.resendVerification({ challenge_id: challengeId });
      setNotice("أرسلنا رمزًا جديدًا.");
    } catch (err) {
      setError(describeApiError(err).message);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={handleConfirm} className="flex flex-col gap-4">
        <AuthError message={error} />
        {notice ? (
          <div className="rounded-xl bg-success-tint px-4 py-3 text-sm text-success">{notice}</div>
        ) : null}
        <p className="text-sm leading-relaxed text-muted">
          أرسلنا رمز التأكيد إلى{" "}
          <b dir="ltr" className="text-ink">
            {destination}
          </b>
          . أدخله لإكمال إنشاء الحساب.
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
          {loading ? "جارٍ التأكيد…" : "تأكيد ومتابعة ←"}
        </Button>
        <button type="button" onClick={handleResend} className="text-sm font-medium text-violet">
          إعادة إرسال الرمز
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSignup} className="flex flex-col gap-4">
      <AuthError message={error} />
      <Field label="الاسم">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="اسمك الكامل"
          className={authInputClass}
        />
      </Field>
      <Field label="البريد الإلكتروني">
        <input
          type="email"
          dir="ltr"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={authInputClass}
        />
      </Field>
      <Field label="رقم الهاتف (واتساب)">
        <input
          type="tel"
          dir="ltr"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+201001234567"
          className={authInputClass}
        />
      </Field>
      <Field label="كلمة المرور">
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
        {loading ? "جارٍ إنشاء الحساب…" : "ابدأ مجانًا ←"}
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-soft">
        بإنشاء الحساب، فإنك توافق على شروط الاستخدام وسياسة الخصوصية.
      </p>
    </form>
  );
}
