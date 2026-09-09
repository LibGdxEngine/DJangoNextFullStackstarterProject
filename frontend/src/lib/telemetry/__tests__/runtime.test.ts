import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { context, propagation, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import { registerServerTelemetry, shutdownServerTelemetry } from "../server";
import { createServerApiClient } from "@/lib/api/server";

it("exports correlated server traces and independent runtime metrics over OTLP without secrets", async () => {
  const telemetry: Record<string, string[]> = {};
  const backendHeaders: Record<string, string | string[] | undefined>[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url || "/";
      (telemetry[path] ??= []).push(Buffer.concat(chunks).toString());
      if (path.startsWith("/api/")) backendHeaders.push(request.headers);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const previousListeners = new Set(process.listeners("SIGTERM"));
  const previousIntListeners = new Set(process.listeners("SIGINT"));
  const previousExitListeners = new Set(process.listeners("beforeExit"));
  vi.stubEnv("OTEL_ENABLED", "true");
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint);
  vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "1");
  vi.stubEnv("BACKEND_API_URL", `${endpoint}/api`);
  try {
    registerServerTelemetry();
    const listenerCount = process.listenerCount("SIGTERM");
    registerServerTelemetry();
    expect(process.listenerCount("SIGTERM")).toBe(listenerCount);
    const requestId = "f047c5c6-ec3e-48e0-b769-dfcb47c5e209";
    const parent = propagation.extract(ROOT_CONTEXT, {
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      "x-request-id": requestId,
      baggage: "password=SENTINEL_SECRET",
    });
    await context.with(parent, () => trace.getTracer("test").startActiveSpan("SENTINEL_SECRET", async (span) => {
      span.setAttribute("http.route", "/api/auth/[...nextauth]");
      span.recordException(new Error("SENTINEL_SECRET"));
      await createServerApiClient("SENTINEL_SECRET").get("/hello/?secret=SENTINEL_SECRET");
      span.end();
    }));
    await shutdownServerTelemetry();
    expect(backendHeaders[0].traceparent).toMatch(new RegExp(`^00-${"a".repeat(32)}-`));
    expect(backendHeaders[0]["x-request-id"]).toBe(requestId);
    expect(backendHeaders[0].baggage).toBeUndefined();
    const traces = (telemetry["/v1/traces"] || []).join("");
    const metricOutput = (telemetry["/v1/metrics"] || []).join("");
    expect(traces).toContain("request.id");
    expect(traces).toContain(requestId);
    expect(traces).not.toContain("SENTINEL_SECRET");
    expect(metricOutput).toContain("process.memory.usage");
    expect(metricOutput).toContain("process.cpu.time");
    expect(metricOutput).toContain("service.instance.id");
  } finally {
    await shutdownServerTelemetry();
    for (const [signal, previous] of [["SIGTERM", previousListeners], ["SIGINT", previousIntListeners]] as const) {
      for (const listener of process.listeners(signal)) {
        if (!previous.has(listener)) process.removeListener(signal, listener);
      }
    }
    for (const listener of process.listeners("beforeExit")) {
      if (!previousExitListeners.has(listener)) process.removeListener("beforeExit", listener);
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  }
});
