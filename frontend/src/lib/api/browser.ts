"use client";

import { getSession } from "next-auth/react";
import { createApiClient } from "./client";

let expireSession: ((token: string) => Promise<void>) | undefined;
const expiring = new Map<string, Promise<void>>();
let expiredToken: string | undefined;

export function registerSessionExpiry(handler: (token: string) => Promise<void>) {
  expireSession = handler;
  return () => {
    if (expireSession === handler) expireSession = undefined;
  };
}

async function onUnauthorized(token: string) {
  if (expiredToken === token) return;
  const pending = expiring.get(token);
  if (pending) return pending;
  const expiration = (async () => {
    const session = await getSession();
    if (session?.sessionGeneration !== token || !expireSession) return;
    await expireSession(token);
    expiredToken = token;
  })();
  expiring.set(token, expiration);
  try {
    await expiration;
  } finally {
    expiring.delete(token);
  }
}

export const apiClient = createApiClient({
  baseUrl: "/api/bff",
  getSessionGeneration: async () => (await getSession())?.sessionGeneration,
  getHeaders: async () => ({ "x-mobser-csrf": "1" }),
  onUnauthorized,
});
