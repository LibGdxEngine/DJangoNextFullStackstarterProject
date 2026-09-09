"use client";

import { SessionProvider as NextAuthSessionProvider, useSession } from "next-auth/react";
import React, { useEffect } from "react";
import { registerSessionExpiry } from "@/lib/api/browser";

function SessionExpiry({ children }: { children: React.ReactNode }) {
  const { update } = useSession();
  useEffect(() => registerSessionExpiry(async (token) => {
    const session = await update({ invalidateAccessToken: token });
    if (!session || session.accessToken === token) {
      throw new Error("Session expiry was not confirmed.");
    }
  }), [update]);
  return children;
}

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <SessionExpiry>{children}</SessionExpiry>
    </NextAuthSessionProvider>
  );
}
