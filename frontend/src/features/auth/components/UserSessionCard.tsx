"use client";

import React, { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function UserSessionCard() {
  const { data: session } = useSession();
  const [error, setError] = useState(false);

  if (!session?.user) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400 uppercase">
            {session.user.name?.[0] || "U"}
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">{session.user.name}</p>
            <p className="text-xs text-zinc-400">Signed in securely</p>
          </div>
        </div>
        <Badge variant="success" size="sm">
          {session.sessionUnavailable ? "Session unavailable" : "Active Session"}
        </Badge>
      </div>

      <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 space-y-2 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-zinc-400">Username:</span>
          <span className="font-mono text-zinc-200">{session.user.name}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-400">Auth Strategy:</span>
          <span className="font-mono text-zinc-200">NextAuth JWT Session</span>
        </div>

      </div>

      {session.sessionUnavailable && <p role="alert" className="text-sm text-amber-300">Your session could not be checked. Please try again shortly.</p>}
      {error && <p role="alert" className="text-sm text-amber-300">Sign out could not be completed. Please try again.</p>}
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={async () => {
          setError(false);
          try {
            const result = await signOut({ redirect: false });
            if (!result?.url) setError(true);
          } catch { setError(true); }
        }}
      >
        Sign Out
      </Button>
    </div>
  );
}
