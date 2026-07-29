import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";

let shutdownHook: (() => Promise<void>) | null = null;

export function initTracing(): void {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    "http://localhost:4318/v1/traces";
  const serviceName =
    process.env.OTEL_SERVICE_NAME || "stellar-bounty-board-api";
  const environment = process.env.NODE_ENV || "development";

  if (process.env.OTEL_LOG_LEVEL === "debug") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const exporter = new OTLPTraceExporter({ url: endpoint });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "deployment.environment": environment,
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();

  shutdownHook = async () => {
    try {
      await provider.shutdown();
    } catch (err) {
      console.error("Error shutting down tracer provider:", err);
    }
  };
}

export async function shutdownTracing(): Promise<void> {
  if (shutdownHook) {
    await shutdownHook();
    shutdownHook = null;
  }
}
