import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../client";

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);
const client = createApiClient({ baseUrl: "https://example.test/api/", token: "access" });

afterEach(() => {
  mockFetch.mockReset();
  vi.useRealTimers();
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("API transport", () => {
  it.each(["get", "post", "put", "patch", "delete"] as const)("supports %s with bearer headers", async (method) => {
    mockFetch.mockResolvedValue(response({ ok: true }));
    await client[method]("/api/items/");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.test/api/items/");
    expect(init?.method).toBe(method.toUpperCase());
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access");
    expect(init?.cache).toBe("no-store");
  });

  it("encodes queries and bodies and allows request headers", async () => {
    mockFetch.mockResolvedValue(response({ ok: true }));
    await client.post("items/", { name: "A" }, {
      query: { search: "x & y", page: 0, active: false, skip: undefined, empty: null },
      headers: { "X-Request-ID": "id" },
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.test/api/items/?search=x+%26+y&page=0&active=false");
    expect(init?.body).toBe('{"name":"A"}');
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init?.headers).get("X-Request-ID")).toBe("id");
  });

  it("supports relative bases and existing query strings", async () => {
    mockFetch.mockResolvedValue(response({}));
    await createApiClient({ baseUrl: "/api" }).get("/items/?first=one", { query: { second: "two" } });
    expect(mockFetch.mock.calls[0][0]).toBe("/api/items/?first=one&second=two");
  });

  it("rejects absolute endpoints so credentials stay at the configured API", async () => {
    await expect(client.get("https://other.test/data")).rejects.toMatchObject({ code: "invalid_url" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns undefined for 204", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await client.delete("items/1/")).toBeUndefined();
  });

  it("preserves structured HTTP errors", async () => {
    mockFetch.mockResolvedValue(response({ error: {
      code: "PHONE_VERIFICATION_REQUIRED", message: "Verify your phone.",
      fields: { "members.0.email": ["Invalid email."] }, context: { phone_masked: "+20***" },
    } }, 403));
    await expect(client.get("profile/")).rejects.toMatchObject({
      name: "ApiError", status: 403, code: "PHONE_VERIFICATION_REQUIRED", message: "Verify your phone.",
      fields: { "members.0.email": ["Invalid email."] }, context: { phone_masked: "+20***" },
    });
  });

  it("distinguishes invalid success JSON from non-JSON HTTP failures", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not JSON"));
    await expect(client.get("items/")).rejects.toMatchObject({ code: "invalid_json", status: 200 });
    mockFetch.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(client.get("items/")).rejects.toMatchObject({ code: "http_error", status: 502 });
  });

  it("wraps network errors without retrying", async () => {
    mockFetch.mockRejectedValue(new TypeError("network"));
    await expect(client.get("items/")).rejects.toBeInstanceOf(ApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 50])("times out with default or custom deadline (%s)", async (timeoutMs) => {
    vi.useFakeTimers();
    mockFetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const result = expect(client.get("items/", { timeoutMs })).rejects.toMatchObject({ code: "timeout", status: 0 });
    await vi.advanceTimersByTimeAsync(timeoutMs ?? 10_000);
    await result;
  });

  it("keeps the deadline active while reading the response body", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(async (_url, init) => ({
      status: 200, ok: true,
      text: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    }) as Response);
    const result = expect(client.get("items/")).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
  });

  it("supports cancellation before and during fetch", async () => {
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await expect(client.get("items/", { signal: alreadyCancelled.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(mockFetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    mockFetch.mockImplementation(async (_url, init) => {
      controller.abort();
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return response({});
    });
    await expect(client.get("items/", { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("invalidates only protected 401s and preserves the API error if cleanup fails", async () => {
    const onUnauthorized = vi.fn().mockRejectedValue(new Error("session unavailable"));
    const protectedClient = createApiClient({ baseUrl: "/api", token: "access", onUnauthorized });
    mockFetch.mockImplementation(async () => response({}, 401));
    await expect(protectedClient.get("private/")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith("access");
    onUnauthorized.mockClear();
    await expect(protectedClient.get("public/", { auth: false })).rejects.toMatchObject({ status: 401 });
    expect(new Headers(mockFetch.mock.calls[1][1]?.headers).has("Authorization")).toBe(false);
    mockFetch.mockResolvedValue(response({}, 403));
    await expect(protectedClient.get("private/")).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

it("bounds token acquisition by the request deadline", async () => {
  vi.useFakeTimers();
  const waitingClient = createApiClient({ baseUrl: "/api", getToken: () => new Promise(() => {}) });
  const result = expect(waitingClient.get("private/")).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(mockFetch).not.toHaveBeenCalled();
});

it("cancels while waiting for a session token", async () => {
  const controller = new AbortController();
  const waitingClient = createApiClient({ baseUrl: "/api", getToken: () => new Promise(() => {}) });
  const result = expect(waitingClient.get("private/", { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  controller.abort();
  await result;
  expect(mockFetch).not.toHaveBeenCalled();
});

it("does not wait on session cleanup to return a 401 error", async () => {
  mockFetch.mockResolvedValue(response({}, 401));
  const waitingClient = createApiClient({ baseUrl: "/api", token: "access", onUnauthorized: () => new Promise(() => {}) });
  await expect(waitingClient.get("private/")).rejects.toMatchObject({ status: 401 });
});

it("supports JSON bodies on DELETE for account confirmation", async () => {
  mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
  await client.delete("/me/", { password: "confirmation" });
  expect(mockFetch.mock.calls[0][1]?.body).toBe('{"password":"confirmation"}');
});
