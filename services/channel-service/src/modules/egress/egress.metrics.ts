import { getMeter } from "@yoizen/observability";

const meter = getMeter("channel-service");

export const egressMessagesSent = meter.createCounter(
  "channel.egress.messages_sent",
  { description: "Total outbound messages sent via provider API" },
);

export const egressSendFailures = meter.createCounter(
  "channel.egress.send_failures",
  { description: "Total failed outbound sends" },
);

export const egressSendDuration = meter.createHistogram(
  "channel.egress.send_duration_ms",
  { description: "Duration of outbound send in milliseconds" },
);

export const egressShadowPublishFailures = meter.createCounter(
  "channel.egress.shadow_publish_failures",
  { description: "Total failed shadow publishes for sent.v1" },
);
