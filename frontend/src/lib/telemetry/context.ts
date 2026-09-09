import "server-only";

import { randomUUID } from "node:crypto";
import { context, createContextKey, type TextMapPropagator } from "@opentelemetry/api";

export const requestIdKey = createContextKey("mobser.request_id");

export function validRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value)
    ? value : undefined;
}

export function currentRequestId(): string | undefined {
  return validRequestId(context.active().getValue(requestIdKey));
}

export const requestIdPropagator: TextMapPropagator = {
  fields: () => ["x-request-id"],
  extract(parent, carrier, getter) {
    const value = getter.get(carrier, "x-request-id");
    return parent.setValue(requestIdKey, validRequestId(value) ?? randomUUID());
  },
  inject(parent, carrier, setter) {
    const value = validRequestId(parent.getValue(requestIdKey));
    if (value) setter.set(carrier, "x-request-id", value);
  },
};
