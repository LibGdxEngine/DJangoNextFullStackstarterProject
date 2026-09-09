import "server-only";

import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { validRequestId } from "./context";

export function safeMethod(value: unknown): string {
  return typeof value === "string" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value) ? value : "OTHER";
}

// Only application route templates are retained; raw request paths may contain PII.
export function safeRoute(value: unknown): string {
  return value === "/" || value === "/api/auth/[...nextauth]" ? value : "other";
}

export function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const attributes: Attributes = {};
  const method = safeMethod(span.attributes["http.request.method"] ?? span.attributes["http.method"]);
  const route = safeRoute(span.attributes["http.route"] ?? span.attributes["next.route"]);
  attributes["http.request.method"] = method;
  attributes["http.route"] = route;
  const status = span.attributes["http.response.status_code"] ?? span.attributes["http.status_code"];
  if (typeof status === "number" && status >= 100 && status <= 599) attributes["http.response.status_code"] = status;
  const requestId = validRequestId(span.attributes["request.id"]);
  if (requestId) attributes["request.id"] = requestId;
  const spanIdentity = span.spanContext();
  return {
    kind: span.kind,
    spanContext: () => ({ traceId: spanIdentity.traceId, spanId: spanIdentity.spanId, traceFlags: spanIdentity.traceFlags }),
    parentSpanContext: span.parentSpanContext && {
      traceId: span.parentSpanContext.traceId,
      spanId: span.parentSpanContext.spanId,
      traceFlags: span.parentSpanContext.traceFlags,
    },
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    name: `${method} ${route}`,
    attributes,
    // Exceptions and span links can carry credentials, SQL parameters, and baggage.
    events: [],
    links: [],
    status: { code: span.status.code },
  };
}
