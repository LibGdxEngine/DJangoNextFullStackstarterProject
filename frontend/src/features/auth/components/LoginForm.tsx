"use client";

import React, { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { SocialAuthButtons } from "@/features/auth/components/SocialAuthButtons";
import { decodeAuthRetry } from "@/lib/api/retry";
import { useRetryCountdown } from "@/hooks/useRetryCountdown";

interface LoginFormProps {
  onSuccess?: () => void;
}

function arabicError(error: string) {
  if (error.includes("CredentialsSignin") || error.includes("INVALID_CREDENTIALS")) return "البريد الإلكتروني أو رقم الهاتف أو كلمة المرور غير صحيحة.";
  return "تعذر تسجيل الدخول. تحقق من بياناتك وحاول مرة أخرى.";
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerificationRequired, setIsVerificationRequired] = useState(false);
  const { remaining, wait } = useRetryCountdown();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (remaining || isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    setIsVerificationRequired(false);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        identifier,
        password,
      });

      if (res?.error) {
        const retry = decodeAuthRetry(res.error);
        if (retry) {
          wait(retry.seconds);
          setErrorMessage(retry.status === 429 ? "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى." : "تسجيل الدخول غير متاح مؤقتًا. حاول بعد قليل.");
        } else if (res.error.includes("PHONE_VERIFICATION_REQUIRED")) {
          setIsVerificationRequired(true);
          setErrorMessage("يجب تأكيد رقم الهاتف عبر واتساب قبل تسجيل الدخول.");
        } else {
          setErrorMessage(arabicError(res.error));
        }
      } else if (res?.ok) {
        setIdentifier("");
        setPassword("");
        if (onSuccess) onSuccess();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? arabicError(err.message) : "حدث خطأ غير متوقع أثناء تسجيل الدخول.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMessage && (
          <div className={`p-3 text-xs rounded-lg border ${
            isVerificationRequired 
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}>
            {errorMessage}
            {isVerificationRequired && (
              <Link href="/register" className="mt-1 block font-medium underline underline-offset-2">
                أكمل تأكيد رقمك من صفحة إنشاء الحساب.
              </Link>
            )}
          </div>
        )}

        <div>
          <label htmlFor="login-identifier" className="block text-sm font-semibold text-slate-800 mb-1.5">
            البريد الإلكتروني أو رقم الهاتف
          </label>
          <input
            id="login-identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
            placeholder="ahmed@example.com أو +201039811349"
            dir="ltr"
            className="w-full px-3 py-2.5 text-sm rounded-lg bg-white border border-slate-300 text-slate-950 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-600"
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-semibold text-slate-800 mb-1.5">
            كلمة المرور
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            dir="ltr"
            placeholder="••••••••"
            className="w-full px-3 py-2.5 text-sm rounded-lg bg-white border border-slate-300 text-slate-950 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-600"
          />
        </div>

        <Button type="submit" variant="primary" className="w-full" isLoading={isLoading} disabled={remaining > 0}>
          {remaining > 0 ? `حاول مجددًا خلال ${remaining} ث` : "تسجيل الدخول"}
        </Button>

        <p className="text-xs text-slate-600 text-center">
          يمكنك استخدام بريدك الإلكتروني أو رقم هاتفك بصيغة دولية.
        </p>
      </form>

      <SocialAuthButtons />
    </div>
  );
}
