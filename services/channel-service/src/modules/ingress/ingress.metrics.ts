import { getMeter } from "@yoizen/observability";

const meter = getMeter("channel-service");

export const ingressMessagesReceived = meter.createCounter(
  "channel.ingress.messages_received",
  { description: "Total inbound messages received from webhook" },
);

export const ingressMessagesPublished = meter.createCounter(
  "channel.ingress.messages_published",
  { description: "Total messages published to JetStream" },
);

export const ingressPublishFailures = meter.createCounter(
  "channel.ingress.publish_failures",
  { description: "Total failed JetStream publishes" },
);

export const ingressClaimCheckCount = meter.createCounter(
  "channel.ingress.claim_check_count",
  { description: "Total messages that used claim-check pattern" },
);

export const ingressClaimCheckStored = meter.createCounter(
  "channel.ingress.claimcheck.stored",
  {
    description:
      "Total claim-check payloads successfully stored in NATS Object Store",
  },
);

export const ingressClaimCheckStoreFailed = meter.createCounter(
  "channel.ingress.claimcheck.store_failed",
  {
    description:
      "Total claim-check payloads that failed to be stored in Object Store",
  },
);

export const ingressPublishDuration = meter.createHistogram(
  "channel.ingress.publish_duration_ms",
  { description: "Duration of JetStream publish in milliseconds" },
);

export const webhookVerificationFailures = meter.createCounter(
  "channel.webhook.verification_failures",
  { description: "Total HMAC verification failures" },
);

export const webhookRequests = meter.createCounter("channel.webhook.requests", {
  description: "Total webhook requests received",
});
