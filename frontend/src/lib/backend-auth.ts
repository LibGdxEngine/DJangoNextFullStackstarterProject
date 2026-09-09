/**
 * Server-side helpers for talking to the Django auth API from NextAuth callbacks.
 */

export interface BackendUser {
  id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
}

export interface BackendAuthResponse {
  access: string;
  refresh: string;
  user?: BackendUser;
  requires_phone?: boolean;
}

export function resolveBackendUrl(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost/api"
  );
}

export function formatUserName(user: BackendUser | undefined, fallback: string): string {
  const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
  return fullName || user?.email || fallback;
}

/**
 * Trades a provider ID token for the same access/refresh pair the password login returns,
 * so the Django backend stays the only issuer of application tokens.
 */
export async function exchangeSocialToken(
  provider: string,
  idToken: string
): Promise<BackendAuthResponse> {
  const res = await fetch(`${resolveBackendUrl()}/v1/auth/social/${provider}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: idToken }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.detail || `${provider} sign-in was rejected by the server.`);
  }

  return data as BackendAuthResponse;
}
