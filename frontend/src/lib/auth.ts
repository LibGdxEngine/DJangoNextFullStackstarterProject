import "server-only";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { formatUserName } from "@/lib/backend-auth";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { logServerEvent } from "@/lib/telemetry/logger";

import { trustedClientIdentity } from "@/lib/api/client-identity";
import { createVaultSession, revokeVaultSession, vaultSessionActive, SESSION_MAX_AGE } from "@/lib/auth-vault";
import { encodeAuthRetry } from "@/lib/api/retry";

export function createAuthOptions(incoming?: Pick<Headers, "get">, onSignOutFailure?: () => void): NextAuthOptions {
const identity = () => trustedClientIdentity(incoming ?? new Headers());
let socialBackend: Awaited<ReturnType<typeof authApi.exchangeSocialToken>> | undefined;
const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Mobser Credentials",
    credentials: {
      identifier: { label: "Email or Phone", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.identifier || !credentials?.password) return null;

      try {
        const data = await authApi.login({
          identifier: credentials.identifier,
          password: credentials.password,
        }, identity());

        return {
          id: data.user?.id || credentials.identifier,
          name: formatUserName(data.user, credentials.identifier),
          email: data.user?.email,
          phone: data.user?.phone ?? undefined,
          ...await createVaultSession(data, identity()),
        };
      } catch (error: unknown) {
        if (error instanceof ApiError && error.code === "PHONE_VERIFICATION_REQUIRED") {
          throw new Error("PHONE_VERIFICATION_REQUIRED");
        }
        if (error instanceof ApiError) {
          const retry = encodeAuthRetry(error.status, error.retryAfterSeconds);
          if (retry) throw new Error(retry);
        }
        const msg = error instanceof Error ? error.message : "Authentication failed.";
        throw new Error(msg);
      }
    },
  }),
];

// A social provider only appears once its credentials are present in the environment.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: { prompt: "consent", access_type: "offline", response_type: "code" },
      },
    })
  );
}

return {
  providers,
  logger: {
    error() { logServerEvent("ERROR", "auth.error"); },
    warn() { logServerEvent("WARN", "auth.warning"); },
    debug() {},
  },
  callbacks: {
    async signIn({ account }) {
      if (!account || account.provider === "credentials") return true;
      if (!account.id_token) return false;
      try {
        socialBackend = await authApi.exchangeSocialToken(account.provider, { token: account.id_token }, identity());
        return true;
      } catch (error) {
        if (error instanceof ApiError) {
          const retry = encodeAuthRetry(error.status, error.retryAfterSeconds);
          if (retry) return `/login?error=${retry}`;
        }
        return false;
      }
    },
    async jwt({ token, user, account }) {
      if (account && account.provider !== "credentials") {
        const backend = socialBackend;
        if (!backend) throw new Error("Social sign-in was not completed.");
        return {
          ...await createVaultSession(backend, identity()),
          sub: backend.user?.id,
          name: formatUserName(backend.user, user?.email ?? account.provider),
          email: backend.user?.email,
          phone: backend.user?.phone ?? undefined,
          requiresPhone: backend.requires_phone ?? false,
        };
      }
      if (user) {
        return { sub: user.id, name: user.name, email: user.email ?? undefined, phone: user.phone,
          sessionId: user.sessionId, sessionGeneration: user.sessionGeneration,
          sessionExpiresAt: user.sessionExpiresAt, requiresPhone: false };
      }
      // Reissue only explicitly permitted cookie fields, dropping legacy Django JWTs.
      return { sub: token.sub, name: token.name, email: token.email, phone: token.phone,
        sessionId: token.sessionId, sessionGeneration: token.sessionGeneration,
        sessionExpiresAt: token.sessionExpiresAt, requiresPhone: token.requiresPhone };
    },
    async session({ session, token }) {
      let active = false;
      let unavailable = false;
      try {
        active = !!token.sessionExpiresAt && token.sessionExpiresAt > Date.now()
          && await vaultSessionActive(token.sessionId);
      } catch {
        unavailable = true;
        logServerEvent("ERROR", "auth.session.unavailable");
      }
      // Construct a fresh browser response; never spread credentials or the vault ID.
      return {
        user: { name: token.name, email: token.email },
        expires: token.sessionExpiresAt ? new Date(token.sessionExpiresAt).toISOString() : session.expires,
        username: token.name ?? undefined, email: token.email ?? undefined, phone: token.phone,
        requiresPhone: token.requiresPhone, sessionGeneration: token.sessionGeneration,
        backendAuthenticated: active, sessionExpired: !active && !unavailable, sessionUnavailable: unavailable,
      };
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && message.token?.sessionId) {
        try { await revokeVaultSession(message.token.sessionId); }
        catch (error) { onSignOutFailure?.(); throw error; }
      }
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
  },
  secret: process.env.NEXTAUTH_SECRET,
};

}

// Session-only consumers have no login request; route handlers create fresh options.
export const authOptions = createAuthOptions();
