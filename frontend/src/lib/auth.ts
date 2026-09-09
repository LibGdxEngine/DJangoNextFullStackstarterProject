import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import {
  exchangeSocialToken,
  formatUserName,
  resolveBackendUrl,
  BackendAuthResponse,
} from "@/lib/backend-auth";

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
        const res = await fetch(`${resolveBackendUrl()}/v1/auth/login/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: credentials.identifier,
            password: credentials.password,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          if (data?.code === "PHONE_VERIFICATION_REQUIRED") {
            throw new Error("PHONE_VERIFICATION_REQUIRED");
          }
          throw new Error(data?.detail || "Authentication failed. Check credentials.");
        }

        return {
          id: data.user?.id || credentials.identifier,
          name: formatUserName(data.user, credentials.identifier),
          email: data.user?.email,
          phone: data.user?.phone,
          accessToken: data.access,
          refreshToken: data.refresh,
        };
      } catch (error: unknown) {
        console.error("Auth authorize error:", error);
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
  callbacks: {
    async jwt({ token, user, account }) {
      if (account && account.provider !== "credentials") {
        if (!account.id_token) {
          throw new Error(`${account.provider} did not return an ID token.`);
        }
        // Throwing aborts sign-in rather than leaving a session without backend tokens.
        const backend: BackendAuthResponse = await exchangeSocialToken(
          account.provider,
          account.id_token
        );
        token.accessToken = backend.access;
        token.refreshToken = backend.refresh;
        token.username = formatUserName(backend.user, user?.email ?? account.provider);
        token.email = backend.user?.email;
        token.phone = backend.user?.phone ?? undefined;
        token.requiresPhone = backend.requires_phone ?? false;
        return token;
      }

      if (user) {
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
