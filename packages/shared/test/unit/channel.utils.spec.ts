import { describe, expect, it } from "bun:test";
import {
  buildChannelSubject,
  buildWebhookIngressSubject,
  parseChannelSubject,
  parseWebhookIngressSubject,
} from "../../src/channel.utils";
import type {
  Channel,
  ChannelProvider,
  MessageKind,
} from "../../src/channel.interfaces";

const channels: Channel[] = ["telegram", "http", "e2e-tests"];
const kinds: MessageKind[] = [
  "received",
  "sent",
  "delivered",
  "read",
  "failed",
  "send",
];

const channelRoundTripCases = channels.flatMap((channel) =>
  kinds.map((kind) => ({
    tenant: `tenant-${channel}`,
    channel,
    provider: channel as ChannelProvider,
    kind,
  })),
);

describe("buildChannelSubject / parseChannelSubject", () => {
  for (const testCase of channelRoundTripCases) {
    it(`round-trips ${testCase.channel} ${testCase.kind}`, () => {
      const subject = buildChannelSubject(
        testCase.tenant,
        testCase.channel,
        testCase.provider,
        testCase.kind,
      );

      expect(parseChannelSubject(subject)).toEqual({
        tenant: testCase.tenant,
        channel: testCase.channel,
        provider: testCase.provider,
        kind: testCase.kind,
        version: "v1",
        producer: "channel-service",
      });
    });
  }

  const explicitVersionCases = [
    {
      tenant: "tenant-versioned",
      channel: "telegram",
      provider: "telegram",
      kind: "received",
      version: "v2",
    },
  ] as const;

  for (const testCase of explicitVersionCases) {
    it(`builds and parses explicit version ${testCase.version}`, () => {
      const subject = buildChannelSubject(
        testCase.tenant,
        testCase.channel,
        testCase.provider,
        testCase.kind,
        testCase.version,
      );

      expect(subject.endsWith(`.${testCase.version}`)).toBe(true);
      expect(parseChannelSubject(subject)).toEqual({
        tenant: testCase.tenant,
        channel: testCase.channel,
        provider: testCase.provider,
        kind: testCase.kind,
        version: testCase.version,
        producer: "channel-service",
      });
    });
  }

  const rejectionCases = [
    ["7 tokens", "evt.t1.channel-service.messaging.telegram.telegram.v1"],
    [
      "9 tokens",
      "evt.t1.channel-service.messaging.telegram.telegram.received.extra.v1",
    ],
    [
      "wrong prefix",
      "cmd.t1.channel-service.messaging.telegram.telegram.received.v1",
    ],
    [
      "wrong producer",
      "evt.t1.api-gateway.messaging.telegram.telegram.received.v1",
    ],
    [
      "wrong domain",
      "evt.t1.channel-service.platform.telegram.telegram.received.v1",
    ],
    ["empty string", ""],
  ] as const;

  for (const [name, subject] of rejectionCases) {
    it(`rejects ${name}`, () => {
      expect(parseChannelSubject(subject)).toBeNull();
    });
  }
});

describe("buildWebhookIngressSubject / parseWebhookIngressSubject", () => {
  const roundTripCases = channels.map((channel) => ({
    tenant: `tenant-${channel}`,
    channel,
  }));

  for (const testCase of roundTripCases) {
    it(`round-trips ${testCase.channel}`, () => {
      const subject = buildWebhookIngressSubject(
        testCase.tenant,
        testCase.channel,
      );

      expect(parseWebhookIngressSubject(subject)).toEqual({
        tenant: testCase.tenant,
        channel: testCase.channel,
        producer: "api-gateway",
        domain: "messaging",
        provider: "webhook",
        kind: "webhook_received",
        version: "v1",
      });
    });
  }

  const rejectionCases = [
    ["7 tokens", "evt.t1.api-gateway.messaging.telegram.webhook.v1"],
    [
      "9 tokens",
      "evt.t1.api-gateway.messaging.telegram.webhook.webhook_received.extra.v1",
    ],
    [
      "wrong prefix",
      "cmd.t1.api-gateway.messaging.telegram.webhook.webhook_received.v1",
    ],
    [
      "wrong producer",
      "evt.t1.channel-service.messaging.telegram.webhook.webhook_received.v1",
    ],
    [
      "wrong domain",
      "evt.t1.api-gateway.platform.telegram.webhook.webhook_received.v1",
    ],
    ["empty string", ""],
  ] as const;

  for (const [name, subject] of rejectionCases) {
    it(`rejects ${name}`, () => {
      expect(parseWebhookIngressSubject(subject)).toBeNull();
    });
  }
});
