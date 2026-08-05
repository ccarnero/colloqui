import { describe, expect, it } from "bun:test";
import { buildWebhookIngressSubject, type Channel } from "@yoizen/shared";
import { buildWebhookIngressType } from "../../src/modules/channels/webhook-ingress-type";

/**
 * envelope-drift T05 (SPEC decision 2, human-approved).
 *
 * Stage 1 used to hardcode `io.yoizen.messaging.webhook.received.v1` for EVERY
 * channel — no `<channel>` token and `received` where the envelope's own `kind`
 * says `webhook_received`. `DOCS/messaging/envelope.md §2.1` prescribes
 * `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`, and its §10.1 worked
 * example is `io.yoizen.messaging.telegram.webhook.webhook_received.v1`.
 *
 * The old literal made `type` useless as a discriminator: a consumer could not
 * recover the channel from it, nor tell stage-1 `webhook_received` apart from a
 * stage-2 `received` (DRIFT.md row 1).
 *
 * COUNTING CONVENTION used throughout these tests and in envelope-schema.json:
 * segments are DOT-SEPARATED, and `io.yoizen` is a two-segment fixed prefix.
 * So the new type has 7 segments (io . yoizen . domain . channel . provider .
 * kind . version) and the old channel-less one had 6.
 */

const ALL_CHANNELS: readonly Channel[] = [
  "whatsapp",
  "instagram",
  "telegram",
  "http",
];

describe("buildWebhookIngressType", () => {
  it("builds the prescriptive per-channel type (7 dot-separated segments)", () => {
    expect(buildWebhookIngressType("telegram")).toBe(
      "io.yoizen.messaging.telegram.webhook.webhook_received.v1"
    );
    expect(buildWebhookIngressType("whatsapp")).toBe(
      "io.yoizen.messaging.whatsapp.webhook.webhook_received.v1"
    );
    expect(buildWebhookIngressType("instagram")).toBe(
      "io.yoizen.messaging.instagram.webhook.webhook_received.v1"
    );
    expect(buildWebhookIngressType("http")).toBe(
      "io.yoizen.messaging.http.webhook.webhook_received.v1"
    );
  });

  it("matches the format documented at envelope.md §2.1", () => {
    for (const channel of ALL_CHANNELS) {
      const tokens = buildWebhookIngressType(channel).split(".");
      // io . yoizen . <domain> . <channel> . <provider> . <kind> . v1
      expect(tokens.length).toBe(7);
      expect(tokens.slice(0, 2)).toEqual(["io", "yoizen"]);
      expect(tokens[2]).toBe("messaging");
      expect(tokens[3]).toBe(channel);
      expect(tokens[4]).toBe("webhook");
      expect(tokens[5]).toBe("webhook_received");
      expect(tokens[6]).toBe("v1");
    }
  });

  it("agrees with the subject built for the same channel", () => {
    // The subject was ALWAYS per-channel (buildWebhookIngressSubject); only the
    // envelope `type` field lagged. Their shared tail must now line up token by
    // token, which is the property that makes `type` a usable discriminator.
    for (const channel of ALL_CHANNELS) {
      const subjectTail = buildWebhookIngressSubject("acme", channel)
        .split(".")
        .slice(-4)
        .join(".");
      const typeTail = buildWebhookIngressType(channel)
        .split(".")
        .slice(-4)
        .join(".");
      expect(typeTail).toBe(subjectTail);
      expect(typeTail).toBe(`${channel}.webhook.webhook_received.v1`);
    }
  });

  it("never emits the old channel-less literal", () => {
    for (const channel of ALL_CHANNELS) {
      expect(buildWebhookIngressType(channel)).not.toBe(
        "io.yoizen.messaging.webhook.received.v1"
      );
    }
  });

  it("is pure — same input, same output, no shared state", () => {
    expect(buildWebhookIngressType("telegram")).toBe(
      buildWebhookIngressType("telegram")
    );
  });
});
