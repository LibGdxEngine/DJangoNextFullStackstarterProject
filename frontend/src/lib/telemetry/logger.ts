import "server-only";

import { randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { currentRequestId, validRequestId } from "./context";
import { safeMethod, safeRoute } from "./safety";

const processState = globalThis as typeof globalThis & { mobserTelemetryInstance?: string };
export const instanceId = processState.mobserTelemetryInstance ??= `${process.pid}-${randomUUID()}`;

export function telemetryEnvironment(): string {
  return process.env.OTEL_RESOURCE_ATTRIBUTES?.split(",")
    .find((attribute) => attribute.startsWith("deployment.environment.name="))?.split("=")[1]
    || process.env.NODE_ENV || "development";
}

type ServerEvent = "auth.vault.unavailable" | "auth.remote_revocation.pending" | "auth.revocation_worker.failed" | "auth.session.unavailable" | "server.request.error" | "auth.error" | "auth.warning" | "telemetry.started" | "telemetry.failed";

export function logServerEvent(level: "INFO" | "WARN" | "ERROR", event: ServerEvent, fields: {
  method?: string;
  route?: string;
  requestId?: unknown;
} = {}) {
  const activeSpan = trace.getActiveSpan()?.spanContext();
  // Deliberately no arbitrary metadata, error messages, stack traces, or headers.
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    severity: level,
    message: event,
    service: process.env.OTEL_SERVICE_NAME || "mobser-frontend",
    environment: telemetryEnvironment(),
    release: process.env.OTEL_SERVICE_VERSION || "development",
    instance_id: instanceId,
    request_id: validRequestId(fields.requestId) ?? currentRequestId(),
    trace_id: activeSpan?.traceId,
    span_id: activeSpan?.spanId,
    ...(fields.method ? { method: safeMethod(fields.method) } : {}),
    ...(fields.route ? { route: safeRoute(fields.route) } : {}),
  })}\n`);
}
