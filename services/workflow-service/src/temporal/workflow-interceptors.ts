import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
} from "@temporalio/interceptors-opentelemetry";

export const interceptors = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
});