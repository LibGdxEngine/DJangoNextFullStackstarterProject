import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_ENABLED === "true"
    && process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      const { registerServerTelemetry } = await import("./lib/telemetry/server");
      registerServerTelemetry();
    } catch {
      const { logServerEvent } = await import("./lib/telemetry/logger");
      logServerEvent("ERROR", "telemetry.failed");
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (_error, request, route) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logServerEvent } = await import("./lib/telemetry/logger");
  logServerEvent("ERROR", "server.request.error", {
    method: request.method,
    route: route.routePath,
    requestId: request.headers["x-request-id"],
  });
};
