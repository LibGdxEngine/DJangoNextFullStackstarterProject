import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { formatUserName } from "@/lib/backend-auth";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { logServerEvent } from "@/lib/telemetry/logger";

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
        });

        return {
          id: data.user?.id || credentials.identifier,
          name: formatUserName(data.user, credentials.identifier),
          email: data.user?.email,
          phone: data.user?.phone ?? undefined,
          accessToken: data.access,
          refreshToken: data.refresh,
        };
      } catch (error: unknown) {
        if (error instanceof ApiError && error.code === "PHONE_VERIFICATION_REQUIRED") {
          throw new Error("PHONE_VERIFICATION_REQUIRED");
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

export const authOptions: NextAuthOptions = {
  providers,
  logger: {
    error() { logServerEvent("ERROR", "auth.error"); },
    warn() { logServerEvent("WARN", "auth.warning"); },
    debug() {},
  },
  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      // Updates carry the failed token; a late 401 cannot clear a different login.
      if (trigger === "update" && typeof session?.invalidateAccessToken === "string"
        && session.invalidateAccessToken === token.accessToken) {
        return { ...token, accessToken: undefined, refreshToken: undefined, sessionExpired: true };
      }
      if (account && account.provider !== "credentials") {
        if (!account.id_token) {
          throw new Error(`${account.provider} did not return an ID token.`);
        }
        // Throwing aborts sign-in rather than leaving a session without backend tokens.
        const backend = await authApi.exchangeSocialToken(account.provider, { token: account.id_token });
        token.sessionExpired = false;
        token.accessToken = backend.access;
        token.refreshToken = backend.refresh;
        token.username = formatUserName(backend.user, user?.email ?? account.provider);
        token.email = backend.user?.email;
        token.phone = backend.user?.phone ?? undefined;
        token.requiresPhone = backend.requires_phone ?? false;
        return token;
      }

      if (user) {
        token.sessionExpired = false;
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.username = user.name ?? undefined;
        token.email = user.email ?? undefined;
        token.phone = user.phone;
        token.requiresPhone = false;
      }
      return token;
    },
    async session({ session, token }) {
      session.sessionExpired = token.sessionExpired;
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.username = token.username;
      session.email = token.email ?? session.user?.email ?? undefined;
      session.phone = token.phone;
      session.requiresPhone = token.requiresPhone;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
