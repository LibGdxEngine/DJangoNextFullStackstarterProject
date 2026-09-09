import "server-only";

import { metrics } from "@opentelemetry/api";
import { registerOTel } from "@vercel/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { requestIdKey, requestIdPropagator, validRequestId } from "./context";
import { instanceId, logServerEvent, telemetryEnvironment } from "./logger";
import { sanitizeSpan } from "./safety";

const state = globalThis as typeof globalThis & {
  mobserTelemetryStarted?: boolean;
  mobserTelemetryShutdown?: () => Promise<void>;
};

export async function shutdownServerTelemetry() {
  await state.mobserTelemetryShutdown?.();
}

export function registerServerTelemetry() {
  if (state.mobserTelemetryStarted || process.env.OTEL_ENABLED !== "true" || process.env.NEXT_PHASE === "phase-production-build") return;
  state.mobserTelemetryStarted = true;
  const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://otel-collector:4318").replace(/\/$/, "");
  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis: 3000 });
  const processor = new BatchSpanProcessor({
    export: (spans, callback) => exporter.export(spans.map(sanitizeSpan), callback),
    shutdown: () => exporter.shutdown(),
  }, { maxQueueSize: 2048, maxExportBatchSize: 256, scheduledDelayMillis: 1000, exportTimeoutMillis: 3000 });
  const safeProcessor: SpanProcessor = {
    onStart(span, parent) {
      const requestId = validRequestId(parent.getValue(requestIdKey));
      if (requestId) span.setAttribute("request.id", requestId);
      processor.onStart(span, parent);
    },
    onEnd: (span) => processor.onEnd(span),
    forceFlush: () => processor.forceFlush(),
    shutdown: () => processor.shutdown(),
  };
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, timeoutMillis: 3000 }),
    exportIntervalMillis: 15000,
    exportTimeoutMillis: 5000,
  });
  const defaultRatio = process.env.NODE_ENV === "production" ? 0.1 : 1;
  const configuredRatio = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? defaultRatio);
  const ratio = Number.isFinite(configuredRatio) && configuredRatio >= 0 && configuredRatio <= 1 ? configuredRatio : defaultRatio;
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || "mobser-frontend",
    attributes: {
      "service.instance.id": instanceId,
      "service.version": process.env.OTEL_SERVICE_VERSION || "development",
      "deployment.environment.name": telemetryEnvironment(),
    },
    // Never propagate arbitrary browser-supplied baggage into backend requests.
    propagators: ["tracecontext", requestIdPropagator],
    traceSampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    spanProcessors: [safeProcessor],
    metricReaders: [metricReader],
    logRecordProcessors: [],
    instrumentationConfig: {
      fetch: {
        propagateContextUrls: [process.env.BACKEND_API_URL || "http://backend:8000/api"],
        ignoreUrls: [endpoint],
      },
    },
  });
  const meter = metrics.getMeter("mobser.node");
  meter.createObservableGauge("process.memory.usage", { unit: "By" })
    .addCallback((result) => result.observe(process.memoryUsage().rss));
  meter.createObservableGauge("nodejs.memory.heap.used", { unit: "By" })
    .addCallback((result) => result.observe(process.memoryUsage().heapUsed));
  meter.createObservableCounter("process.cpu.time", { unit: "s" }).addCallback((result) => {
    const usage = process.cpuUsage();
    result.observe(usage.user / 1e6, { "cpu.mode": "user" });
    result.observe(usage.system / 1e6, { "cpu.mode": "system" });
  });
  meter.createObservableGauge("process.uptime", { unit: "s" })
    .addCallback((result) => result.observe(process.uptime()));
  let shutdown: Promise<void> | undefined;
  state.mobserTelemetryShutdown = () => shutdown ??= (async () => {
    await Promise.allSettled([processor.shutdown(), metricReader.shutdown()]);
  })();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    // Next's installed cleanup exits the process; run bounded exports before
    // delegating to it, preserving Next's connection and development cleanup.
    const nextCleanup = process.listeners(signal).find((listener) => listener.name === "cleanup");
    if (nextCleanup) process.removeListener(signal, nextCleanup);
    process.once(signal, async () => {
      await shutdownServerTelemetry();
      if (nextCleanup) nextCleanup.call(process, signal);
      else process.exit(signal === "SIGTERM" ? 143 : 130);
    });
  }
  process.once("beforeExit", shutdownServerTelemetry);
  logServerEvent("INFO", "telemetry.started");
}
