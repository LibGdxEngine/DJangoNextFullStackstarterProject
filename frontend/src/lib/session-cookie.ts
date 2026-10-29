import "server-only";

import { cookies } from "next/headers";
import { decode, type JWT } from "next-auth/jwt";

const COOKIE_NAMES = ["__Secure-next-auth.session-token", "next-auth.session-token"];

/**
 * Reads the NextAuth session token without running the `jwt` callback.
 *
 * Server components must use this instead of `getServerSession`: that runs the callback,
 * which may rotate the refresh token, but a server component cannot write the rotated
 * pair back to the cookie. The browser then presents the old refresh token, and the
 * backend treats the reuse as theft and revokes the session.
 */
export async function readSessionToken(): Promise<JWT | null> {
  const jar = await cookies();
  for (const name of COOKIE_NAMES) {
    // Large sessions are split into `name.0`, `name.1`, ... cookies.
    const chunks = jar
      .getAll()
      .filter((cookie) => cookie.name.startsWith(`${name}.`))
      .sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1)))
      .map((cookie) => cookie.value)
      .join("");
    const raw = jar.get(name)?.value ?? (chunks || undefined);
    if (!raw) continue;
    try {
      return await decode({ token: raw, secret: process.env.NEXTAUTH_SECRET ?? "" });
    } catch {
      return null;
    }
  }
  return null;
}
