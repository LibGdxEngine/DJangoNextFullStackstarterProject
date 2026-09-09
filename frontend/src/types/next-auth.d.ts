import { DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    backendAuthenticated?: boolean;
    sessionUnavailable?: boolean;
    sessionGeneration?: string;
    username?: string;
    email?: string;
    phone?: string;
    requiresPhone?: boolean;
    sessionExpired?: boolean;
  }
  interface User extends DefaultUser {
    sessionId?: string;
    sessionGeneration?: string;
    sessionExpiresAt?: number;
    phone?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionId?: string;
    sessionGeneration?: string;
    sessionExpiresAt?: number;
    username?: string;
    email?: string;
    phone?: string;
    requiresPhone?: boolean;
    sessionExpired?: boolean;
  }
}
