"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        username,
        password,
      });

      if (res?.error) {
        setErrorMessage(res.error || "Authentication failed. Check credentials.");
      } else {
        setUsername("");
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className="p-3 text-xs rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
          {errorMessage}
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="admin"
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
        Sign In with Django SimpleJWT
      </Button>

      <p className="text-xs text-zinc-500 text-center">
        Tip: Run <code className="text-zinc-400">make createsuperuser</code> to configure credentials.
      </p>
    </form>
  );
}
