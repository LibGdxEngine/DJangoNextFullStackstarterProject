import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Mobser Credentials",
      credentials: {
        identifier: { label: "Email or Phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null;

        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";
          const backendUrl = process.env.BACKEND_API_URL || apiUrl;

          const res = await fetch(`${backendUrl}/v1/auth/login/`, {
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
            name: `${data.user?.first_name || ""} ${data.user?.last_name || ""}`.trim() || data.user?.email || credentials.identifier,
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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.username = user.name ?? undefined;
        token.email = user.email ?? undefined;
        token.phone = user.phone;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.username = token.username;
      session.email = token.email ?? session.user?.email ?? undefined;
      session.phone = token.phone;
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
