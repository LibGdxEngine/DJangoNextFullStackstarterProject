"use client";

import React, { useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";

interface SocialAuthButtonsProps {
  callbackUrl?: string;
}

interface ProviderMeta {
  label: string;
  icon: React.ReactNode;
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
      />
    </svg>
  );
}

// Adding another provider is one entry here plus its credentials in the environment.
const PROVIDER_META: Record<string, ProviderMeta> = {
  google: { label: "Continue with Google", icon: <GoogleIcon /> },
};

export function SocialAuthButtons({ callbackUrl = "/" }: SocialAuthButtonsProps) {
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    getProviders().then((available) => {
      if (!isActive || !available) return;
      setProviderIds(Object.keys(available).filter((id) => id in PROVIDER_META));
      if (new URLSearchParams(window.location.search).get("error")) {
        setErrorMessage("Social sign-in failed. Please try again or use your email and password.");
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  if (providerIds.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-zinc-800" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          or continue with
        </span>
        <span className="h-px flex-1 bg-zinc-800" />
      </div>

      {errorMessage && (
        <div className="p-3 text-xs rounded-lg border bg-red-500/10 border-red-500/20 text-red-400">
          {errorMessage}
        </div>
      )}

      <div className="space-y-2">
        {providerIds.map((id) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            className="w-full"
            isLoading={pendingProvider === id}
            disabled={pendingProvider !== null}
            onClick={() => {
              setPendingProvider(id);
              setErrorMessage(null);
              signIn(id, { callbackUrl });
            }}
          >
            {pendingProvider !== id && <span className="mr-2">{PROVIDER_META[id].icon}</span>}
            {PROVIDER_META[id].label}
          </Button>
        ))}
      </div>
    </div>
  );
}
