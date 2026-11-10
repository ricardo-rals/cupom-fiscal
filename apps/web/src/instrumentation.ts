import { registerOTel } from "@vercel/otel";

// Exporta só quando o compose define OTEL_EXPORTER_OTLP_ENDPOINT.
export function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  registerOTel({
    serviceName: "web",
    // Fora da Vercel o traceparent só vai para URLs liberadas: a api entra no mesmo trace.
    instrumentationConfig: {
      fetch: { propagateContextUrls: process.env.API_URL ? [process.env.API_URL] : [] },
    },
  });
}
