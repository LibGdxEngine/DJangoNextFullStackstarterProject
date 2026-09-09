import { retrySeconds } from "./retry";

export type ErrorFields = Record<string, string[]>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fields: ErrorFields = {},
    public readonly context?: Record<string, unknown>,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  auth?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ClientOptions {
  baseUrl: string;
  token?: string;
  getToken?: () => Promise<string | undefined>;
  getSessionGeneration?: () => Promise<string | undefined>;
  getHeaders?: () => Promise<HeadersInit>;
  onUnauthorized?: (token: string) => Promise<void>;
  timeoutMs?: number;
}

function requestUrl(baseUrl: string, endpoint: string, query?: RequestOptions["query"]) {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(endpoint)) {
    throw new ApiError("API endpoints must be relative paths.", 0, "invalid_url");
  }
  const base = baseUrl.replace(/\/+$/, "");
  let path = `/${endpoint.replace(/^\/+/, "")}`;
  if (base.endsWith("/api") && (path === "/api" || path.startsWith("/api/"))) {
    path = path.slice(4);
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) params.append(key, String(value));
  }
  const suffix = params.toString();
  return `${base}${path}${suffix ? `${path.includes("?") ? "&" : "?"}${suffix}` : ""}`;
}

function httpError(data: unknown, status: number, headers: Headers): ApiError {
  const retry = retrySeconds(headers.get("Retry-After"));
  const envelope = data && typeof data === "object" && "error" in data ? data.error : null;
  if (envelope && typeof envelope === "object") {
    const error = envelope as Record<string, unknown>;
    const fields: ErrorFields = {};
    if (error.fields && typeof error.fields === "object") {
      for (const [key, value] of Object.entries(error.fields)) {
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) fields[key] = value;
      }
    }
    return new ApiError(
      typeof error.message === "string" ? error.message : `Request failed (HTTP ${status}).`,
      status,
      typeof error.code === "string" ? error.code : "http_error",
      fields,
      error.context && typeof error.context === "object" && !Array.isArray(error.context)
        ? error.context as Record<string, unknown> : undefined,
      retry,
    );
  }
  return new ApiError(`Request failed (HTTP ${status}).`, status, "http_error", {}, undefined, retry);
}

export function createApiClient(config: ClientOptions) {
  async function request<T>(method: string, endpoint: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? config.timeoutMs ?? 10_000);
    let response: Response | undefined;
    let token: string | undefined;
    let sessionGeneration: string | undefined;
    try {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      void aborted.catch(() => undefined);
      token = options.auth === false ? undefined : config.token ?? await Promise.race([config.getToken?.(), aborted]);
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      sessionGeneration = options.auth === false ? undefined : await config.getSessionGeneration?.();
      const headers = new Headers(options.headers);
      new Headers(await config.getHeaders?.()).forEach((value, key) => headers.set(key, value));
      headers.set("Accept", "application/json");
      if (body !== undefined) headers.set("Content-Type", "application/json");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(requestUrl(config.baseUrl, endpoint, options.query), {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new ApiError("The server returned invalid JSON.", response.status, "invalid_json");
      }
      if (!response.ok) throw httpError(data, response.status, response.headers);
      return data as T;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(timedOut ? "The request timed out." : "The request was cancelled.", 0, timedOut ? "timeout" : "cancelled");
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError("Unable to reach the server.", 0, "network_error");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (response?.status === 401 && (token || sessionGeneration) && options.auth !== false) {
        // Session cleanup must never replace the original API failure.
        void config.onUnauthorized?.((sessionGeneration ?? token)!).catch(() => undefined);
      }
    }
  }

  return {
    get: <T>(endpoint: string, options?: RequestOptions) => request<T>("GET", endpoint, undefined, options),
    post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) => request<T>("POST", endpoint, body, options),
    put: <T>(endpoint: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", endpoint, body, options),
    patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", endpoint, body, options),
    delete: <T = void>(endpoint: string, body?: unknown, options?: RequestOptions) => request<T>("DELETE", endpoint, body, options),
  };
}
