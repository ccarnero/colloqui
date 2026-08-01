import { describe, expect, it } from "bun:test";
import { createChannelEnvelope } from "../../src/domain/envelope.factory";

describe("createChannelEnvelope", () => {
  it("builds envelope with idempotency and subject", () => {
    const env = createChannelEnvelope({
      tenantId: "tenant-a",
      channel: "whatsapp",
      provider: "meta",
      kind: "received",
      message: {
        messageId: "m1",
        from: "+1",
        timestamp: "123",
        type: "text",
        text: "hi",
        raw: {},
      },
      accountId: "acc-1",
    });
    expect(env.tenant).toBe("tenant-a");
    expect(env.channel).toBe("whatsapp");
    expect(env.kind).toBe("received");
    expect(env.producer).toBe("channel-service");
    expect(env.domain).toBe("messaging");
    expect(env.accountid).toBe("acc-1");

    expect(env.idempotencykey).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(env.data.payload_inline).toBe(true);
    const payload = env.data.payload as Record<string, unknown>;
    expect(payload.messageId).toBe("m1");
    expect(payload.accountId).toBe("acc-1");

    expect(env.transport.depth).toBe(0);
  });

  it("produces deterministic idempotencyKey for identical raw payloads", () => {
    const base = {
      tenantId: "t1",
      channel: "whatsapp" as const,
      provider: "meta" as const,
      kind: "received" as const,
      accountId: "acc-1",
      message: {
        messageId: "m1",
        from: "+1",
        timestamp: "123",
        type: "text" as const,
        text: "hello",
      },
    };
    const a = createChannelEnvelope(base);
    const b = createChannelEnvelope(base);
    expect(a.idempotencykey).toBe(b.idempotencykey);
  });

  // =========================================================================
  // envelope-drift T06 (SPEC decision 1, human-approved CLEAN cutover).
  //
  // The webhook header allowlist used to enter the envelope through an
  // UNTYPED conditional spread into `transport`:
  //     transport: { method, protocol, depth, ...(webhookHeaders && { headers }) }
  // A spread bypasses TypeScript's excess-property check, so `headers` landed
  // on `EventTransport` even though that interface declares only
  // method/protocol/agent_id?/depth? (packages/shared/src/interfaces.ts:13-18).
  // DOCS/messaging/envelope.md §4.1 says the allowlist belongs under `data`,
  // and the stage-1 shape already has it there (IWebhookIngressData.headers,
  // webhook.interfaces.ts:18). Stage 2 now matches, typed.
  // =========================================================================
  describe("webhook header allowlist placement", () => {
    const baseOptions = {
      tenantId: "tenant-a",
      channel: "whatsapp" as const,
      provider: "meta" as const,
      kind: "received" as const,
      accountId: "acc-1",
      message: {
        messageId: "m1",
        from: "+1",
        timestamp: "123",
        type: "text",
        text: "hi",
        raw: {},
      },
    };

    it("puts the allowlist under data.headers, never on transport", () => {
      const headers = {
        "content-type": "application/json",
        "user-agent": "TelegramBot",
      };
      const env = createChannelEnvelope({
        ...baseOptions,
        webhookHeaders: headers,
      });

      expect(env.data.headers).toEqual(headers);
      expect("headers" in env.transport).toBe(false);
    });

    it("passes the allowlist through byte-identically (no filtering, no renaming)", () => {
      // The factory has never filtered — api-gateway applies
      // WEBHOOK_FORWARDED_HEADERS, channel-service lowercases keys and strips
      // the WEBHOOK_SECRET_HEADERS subset (since 2026-08-01) before this
      // point. Pinning pass-through keeps that division of labour honest,
      // which is also why the fixture carries no secret header: callers may
      // no longer hand the factory one.
      const headers = {
        "content-type": "application/json",
        "x-request-id": "req-1",
        "user-agent": "TelegramBot",
      };
      const env = createChannelEnvelope({
        ...baseOptions,
        webhookHeaders: headers,
      });
      expect(env.data.headers).toEqual(headers);
      expect(Object.keys(env.data.headers ?? {})).toEqual(Object.keys(headers));
    });

    it("omits data.headers entirely when no allowlist is supplied", () => {
      const env = createChannelEnvelope(baseOptions);
      expect("headers" in env.data).toBe(false);
      expect(env.data.headers).toBeUndefined();
    });

    it("emits transport with EXACTLY its four declared fields", () => {
      // Regression pin for the conditional-spread hole: any key beyond the
      // EventTransport declaration fails here, whether or not tsc catches it.
      const declared = ["method", "protocol", "agent_id", "depth"];

      for (const options of [
        baseOptions,
        {
          ...baseOptions,
          webhookHeaders: { "content-type": "application/json" },
        },
      ]) {
        const env = createChannelEnvelope(options);
        const unexpected = Object.keys(env.transport).filter(
          (key) => !declared.includes(key)
        );
        expect(unexpected).toEqual([]);
      }
    });

    it("keeps transport's own values unchanged by the move", () => {
      const env = createChannelEnvelope({
        ...baseOptions,
        depth: 2,
        webhookHeaders: { "content-type": "application/json" },
      });
      expect(env.transport.method).toBe("webhook");
      expect(env.transport.protocol).toBe("https");
      expect(env.transport.depth).toBe(2);
      expect(Object.keys(env.transport).sort()).toEqual(
        ["depth", "method", "protocol"].sort()
      );
    });
  });
});
