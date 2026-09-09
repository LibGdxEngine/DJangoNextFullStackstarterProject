import { DefaultUser } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    username?: string;
    email?: string;
    phone?: string;
    requiresPhone?: boolean;
    sessionExpired?: boolean;
  }
  interface User extends DefaultUser {
    accessToken?: string;
    refreshToken?: string;
    phone?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    username?: string;
    email?: string;
    phone?: string;
    requiresPhone?: boolean;
    sessionExpired?: boolean;
  }
}
