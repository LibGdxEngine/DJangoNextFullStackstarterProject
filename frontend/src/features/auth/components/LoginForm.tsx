"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { SocialAuthButtons } from "@/features/auth/components/SocialAuthButtons";

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerificationRequired, setIsVerificationRequired] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        if (res.error.includes("PHONE_VERIFICATION_REQUIRED")) {
          setIsVerificationRequired(true);
          setErrorMessage("WhatsApp phone verification is required before logging in.");
        } else {
          setErrorMessage(res.error || "Authentication failed. Check credentials.");
        }
      } else {
        setIdentifier("");
        setPassword("");
        if (onSuccess) onSuccess();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred during login.");
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
              ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}>
            {errorMessage}
            {isVerificationRequired && (
              <p className="mt-1 font-medium underline cursor-pointer">
                Click here to confirm your WhatsApp verification code.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
            Email or Phone
          </label>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            placeholder="ahmed@example.com or +201039811349"
            className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
          Sign In with Email or Phone
        </Button>

        <p className="text-xs text-zinc-500 text-center">
          Tip: Identified by canonical email or E.164 phone. Authenticated via password.
        </p>
      </form>

      <SocialAuthButtons />
    </div>
  );
}
