"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useRetryCountdown } from "@/hooks/useRetryCountdown";
import { Button } from "@/components/ui/Button";
import { AuthApiError, browserAuthApi } from "@/lib/api/browser-auth";

type SignupData = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  password: string;
};

const emptySignup: SignupData = { first_name: "", last_name: "", email: "", phone: "", password: "" };

function errorMessage(error: unknown) {
  if (error instanceof AuthApiError) {
    if (error.status === 429) return "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.";
    if (error.code === "validation_error") {
      if (error.fields.email) return "هذا البريد الإلكتروني مستخدم أو غير صالح.";
      if (error.fields.phone) return "رقم الهاتف غير صالح أو مرتبط بحساب آخر.";
      if (error.fields.password) return "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.";
      if (error.message.includes("email")) return "يوجد حساب مسجل بهذا البريد الإلكتروني.";
      if (error.message.includes("phone")) return "يوجد حساب مسجل برقم الهاتف هذا.";
    }
  }
  return "تعذر إكمال الطلب الآن. تحقق من البيانات وحاول مرة أخرى.";
}

export function RegisterForm() {
  const router = useRouter();
  const [data, setData] = useState(emptySignup);
  const [challenge, setChallenge] = useState<{ id: string; destination: string } | null>(null);
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { remaining, wait } = useRetryCountdown();

  const update = (field: keyof SignupData) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setData((current) => ({ ...current, [field]: event.target.value }));

  async function signup(event: React.FormEvent) {
    event.preventDefault();
    if (remaining || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await browserAuthApi.signup(data);
      setChallenge({ id: result.challenge_id, destination: result.destination });
      setMessage(`تم طلب إرسال رمز التأكيد عبر واتساب إلى ${result.destination}.`);
    } catch (requestError) {
      if (requestError instanceof AuthApiError && requestError.status === 429) {
        wait(requestError.retryAfterSeconds ?? 5);
      }
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge || remaining || isLoading) return;
    setIsLoading(true);
    setError(null);
    let verified = false;
    try {
      await browserAuthApi.confirmVerification({ challenge_id: challenge.id, code });
      verified = true;
      const result = await signIn("credentials", { redirect: false, identifier: data.email, password: data.password });
      if (!result?.ok) throw new Error("login_failed");
      router.replace("/account");
      router.refresh();
    } catch (requestError) {
      if (requestError instanceof AuthApiError && requestError.status === 429) {
        wait(requestError.retryAfterSeconds ?? 5);
      }
      setError(verified
        ? "تم تأكيد الرقم، لكن تعذر تسجيل الدخول تلقائيًا. انتقل إلى صفحة تسجيل الدخول."
        : requestError instanceof AuthApiError && requestError.status === 400 && requestError.code === "validation_error"
          ? "رمز التأكيد غير صحيح أو انتهت صلاحيته."
          : errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  async function resend() {
    if (!challenge || remaining || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      await browserAuthApi.resendVerification({ challenge_id: challenge.id });
      setMessage("تم طلب إرسال رمز جديد عبر واتساب.");
    } catch (requestError) {
      if (requestError instanceof AuthApiError && requestError.status === 429) {
        wait(requestError.retryAfterSeconds ?? 5);
      }
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={confirm} className="space-y-4">
        {message && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">{message}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div>
          <label htmlFor="verification-code" className="mb-1.5 block text-sm font-semibold text-slate-800">رمز التأكيد</label>
          <input id="verification-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required maxLength={10} dir="ltr" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200" />
        </div>
        <Button type="submit" className="w-full" isLoading={isLoading} disabled={remaining > 0}>{remaining > 0 ? `حاول مجددًا خلال ${remaining} ث` : "تأكيد وإنشاء الحساب"}</Button>
        <button type="button" onClick={resend} disabled={isLoading || remaining > 0} className="w-full text-sm font-semibold text-teal-800 underline underline-offset-4 disabled:opacity-50">إعادة إرسال الرمز</button>
      </form>
    );
  }

  return (
    <form onSubmit={signup} className="space-y-4">
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="first-name" className="mb-1.5 block text-sm font-semibold text-slate-800">الاسم الأول</label><input id="first-name" value={data.first_name} onChange={update("first_name")} autoComplete="given-name" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200" /></div>
        <div><label htmlFor="last-name" className="mb-1.5 block text-sm font-semibold text-slate-800">اسم العائلة</label><input id="last-name" value={data.last_name} onChange={update("last_name")} autoComplete="family-name" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200" /></div>
      </div>
      <div><label htmlFor="signup-email" className="mb-1.5 block text-sm font-semibold text-slate-800">البريد الإلكتروني</label><input id="signup-email" type="email" value={data.email} onChange={update("email")} autoComplete="email" required dir="ltr" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200" /></div>
      <div><label htmlFor="signup-phone" className="mb-1.5 block text-sm font-semibold text-slate-800">رقم الهاتف</label><input id="signup-phone" type="tel" value={data.phone} onChange={update("phone")} autoComplete="tel" placeholder="+201012345678" required dir="ltr" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200" /><p className="mt-1 text-xs text-slate-600">يُرسل رمز التأكيد إلى هذا الرقم عبر واتساب عند تهيئة خدمة الرسائل.</p></div>
      <div><label htmlFor="signup-password" className="mb-1.5 block text-sm font-semibold text-slate-800">كلمة المرور</label><input id="signup-password" type="password" value={data.password} onChange={update("password")} autoComplete="new-password" minLength={8} required dir="ltr" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-200" /><p className="mt-1 text-xs text-slate-600">8 أحرف على الأقل.</p></div>
      <Button type="submit" className="w-full" isLoading={isLoading} disabled={remaining > 0}>{remaining > 0 ? `حاول مجددًا خلال ${remaining} ث` : "إنشاء حساب"}</Button>
    </form>
  );
}
