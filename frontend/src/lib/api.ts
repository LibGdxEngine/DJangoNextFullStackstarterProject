export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "/api";

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...customConfig } = options;

  const config: RequestInit = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...customConfig,
  };

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${API_BASE_URL}${cleanEndpoint}`;

  const res = await fetch(url, config);

  if (!res.ok) {
    let errorData: { detail?: string; message?: string } | null = null;
    try {
      errorData = (await res.json()) as { detail?: string; message?: string };
    } catch {
      // Ignored if non-json
    }
    throw new ApiError(
      errorData?.detail || errorData?.message || `HTTP ${res.status}: ${res.statusText}`,
      res.status,
      errorData
    );
  }

  // If 204 No Content
  if (res.status === 204) {
    return {} as T;
  }

  return res.json() as Promise<T>;
}
