import { afterEach, expect, it, vi } from "vitest";
import { ROOT_CONTEXT, SpanStatusCode, defaultTextMapGetter, defaultTextMapSetter } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { requestIdKey, requestIdPropagator } from "../context";
import { sanitizeSpan } from "../safety";
import { logServerEvent } from "../logger";
import { onRequestError, register } from "@/instrumentation";

afterEach(() => vi.unstubAllEnvs());

it("drops secrets from real SDK span names, attributes, exceptions, status and links", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const span = provider.getTracer("test").startSpan("GET https://user:SENTINEL_SECRET@example.test?otp=SENTINEL_SECRET", {
    attributes: {
      "http.method": "GET", "http.route": "/", "http.status_code": 500,
      "http.url": "https://example.test?password=SENTINEL_SECRET",
      "http.request.header.authorization": "Bearer SENTINEL_SECRET",
      "db.statement": "select 'SENTINEL_SECRET'",
      "request.id": "f047c5c6-ec3e-48e0-b769-dfcb47c5e209",
    },
    links: [{ context: { traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }, attributes: { secret: "SENTINEL_SECRET" } }],
  });
  span.recordException(new Error("SENTINEL_SECRET"));
  span.setStatus({ code: SpanStatusCode.ERROR, message: "SENTINEL_SECRET" });
  span.end();
  await provider.forceFlush();
  const safe = sanitizeSpan(exporter.getFinishedSpans()[0]);
  expect(JSON.stringify(safe)).not.toContain("SENTINEL_SECRET");
  expect(safe.name).toBe("GET /");
  expect(safe.status.code).toBe(SpanStatusCode.ERROR);
  expect(safe.spanContext()).toEqual(span.spanContext());
  expect(safe.attributes["request.id"]).toBe("f047c5c6-ec3e-48e0-b769-dfcb47c5e209");
  await provider.shutdown();
});

it("validates request IDs and generates fresh IDs instead of forwarding arbitrary header data", () => {
  const valid = "f047c5c6-ec3e-48e0-b769-dfcb47c5e209";
  const ctx = requestIdPropagator.extract(ROOT_CONTEXT, { "x-request-id": valid }, defaultTextMapGetter);
  const output: Record<string, string> = {};
  requestIdPropagator.inject(ctx, output, defaultTextMapSetter);
  expect(output["x-request-id"]).toBe(valid);
  const untrusted = requestIdPropagator.extract(ROOT_CONTEXT, { "x-request-id": "user@example.test SENTINEL_SECRET" }, defaultTextMapGetter);
  expect(untrusted.getValue(requestIdKey)).toMatch(/^[a-f0-9-]{36}$/);
  expect(ROOT_CONTEXT.getValue(requestIdKey)).toBeUndefined();
});

it("logs fixed events and safe route metadata without request paths, headers or error contents", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  await onRequestError(Object.assign(new Error("SENTINEL_SECRET"), { digest: "SENTINEL_SECRET" }), {
    path: "/?token=SENTINEL_SECRET", method: "POST",
    headers: { authorization: "SENTINEL_SECRET", "x-request-id": "SENTINEL_SECRET" },
  }, { routerKind: "App Router", routePath: "/api/auth/[...nextauth]", routeType: "route", revalidateReason: undefined });
  logServerEvent("ERROR", "auth.error");
  const output = write.mock.calls.map(([value]) => String(value)).join("");
  expect(output).not.toContain("SENTINEL_SECRET");
  expect(output).toContain('"route":"/api/auth/[...nextauth]"');
  expect(output).toContain('"message":"auth.error"');
});

it.each([
  ["nodejs", "false", "phase-production-server"],
  ["edge", "true", "phase-production-server"],
  ["nodejs", "true", "phase-production-build"],
])("does not initialize telemetry for runtime %s enabled %s phase %s", async (runtime, enabled, phase) => {
  vi.stubEnv("NEXT_RUNTIME", runtime);
  vi.stubEnv("OTEL_ENABLED", enabled);
  vi.stubEnv("NEXT_PHASE", phase);
  const listeners = process.listenerCount("SIGTERM");
  await register();
  expect(process.listenerCount("SIGTERM")).toBe(listeners);
});
