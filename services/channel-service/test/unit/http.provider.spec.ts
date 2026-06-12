import { describe, it, expect, beforeEach } from "bun:test";
import { createHash } from "crypto";

const { HttpProvider } = await import(
  "../../src/providers/http/http.provider"
);

/** Compute the expected deterministic messageId for a given body. */
function expectedId(body: Record<string, unknown>): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.keys(body).sort().map((k) => [k, body[k]])),
  );
  return createHash("sha1").update(sorted).digest("hex").slice(0, 16);
}

describe("HttpProvider", () => {
  let provider: InstanceType<typeof HttpProvider>;

  beforeEach(() => {
    provider = new HttpProvider();
  });

  describe("metadata", () => {
    it("has channel=http, provider=http, signatureHeader=x-http-channel-token", () => {
      expect(provider.channel).toBe("http");
      expect(provider.provider).toBe("http");
      expect(provider.signatureHeader).toBe("x-http-channel-token");
    });
  });

  describe("parseWebhook", () => {
    it("returns [] when 'from' is missing", () => {
      const msgs = provider.parseWebhook({ text: "hello" });
      expect(msgs).toHaveLength(0);
    });

    it("returns [] when 'from' is empty string", () => {
      const msgs = provider.parseWebhook({ from: "", text: "hello" });
      expect(msgs).toHaveLength(0);
    });

    it("uses provided messageId verbatim", () => {
      const msgs = provider.parseWebhook({
        from: "user-1",
        messageId: "msg-explicit",
        text: "hi",
      });
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.messageId).toBe("msg-explicit");
    });

    it("uses provided timestamp verbatim", () => {
      const msgs = provider.parseWebhook({
        from: "user-1",
        timestamp: "1718000000",
      });
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.timestamp).toBe("1718000000");
    });

    it("derives messageId deterministically when absent", () => {
      const body = { from: "user-1", text: "hello" };
      const msgs = provider.parseWebhook(body);
      expect(msgs[0]?.messageId).toBe(expectedId(body));
    });

    it("derived messageId is key-order independent", () => {
      const body1 = { from: "user-1", text: "hello" };
      const body2 = { text: "hello", from: "user-1" };
      const msgs1 = provider.parseWebhook(body1);
      const msgs2 = provider.parseWebhook(body2);
      expect(msgs1[0]?.messageId).toBe(msgs2[0]?.messageId);
    });

    it("derived messageId is exactly 16 hex chars", () => {
      const msgs = provider.parseWebhook({ from: "user-1" });
      expect(msgs[0]?.messageId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("defaults type to 'text'", () => {
      const msgs = provider.parseWebhook({ from: "user-1" });
      expect(msgs[0]?.type).toBe("text");
    });

    it("uses provided type", () => {
      const msgs = provider.parseWebhook({ from: "user-1", type: "image" });
      expect(msgs[0]?.type).toBe("image");
    });

    it("extracts text when provided", () => {
      const msgs = provider.parseWebhook({ from: "user-1", text: "world" });
      expect(msgs[0]?.text).toBe("world");
    });

    it("defaults raw to the full body when not provided", () => {
      const body = { from: "user-1", text: "hi" };
      const msgs = provider.parseWebhook(body);
      expect(msgs[0]?.raw).toEqual(body);
    });

    it("uses provided raw when present", () => {
      const customRaw = { nested: true };
      const msgs = provider.parseWebhook({
        from: "user-1",
        raw: customRaw,
      });
      expect(msgs[0]?.raw).toEqual(customRaw);
    });

    it("falls back raw to the full body when raw is an array", () => {
      const body = { from: "user-1", raw: [1, 2, 3] };
      const msgs = provider.parseWebhook(body);
      expect(msgs[0]?.raw).toEqual(body);
    });

    it("falls back timestamp to String(Date.now()) shape when absent", () => {
      const before = Date.now();
      const msgs = provider.parseWebhook({ from: "user-1" });
      const after = Date.now();
      const ts = Number(msgs[0]?.timestamp);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("verifySignature", () => {
    it("returns true when signature equals secret", () => {
      const secret = "my-secret-token";
      const ok = provider.verifySignature(
        new Uint8Array([1, 2, 3]),
        secret,
        secret,
      );
      expect(ok).toBe(true);
    });

    it("returns false when lengths differ", () => {
      const ok = provider.verifySignature(new Uint8Array(), "short", "longer-secret");
      expect(ok).toBe(false);
    });

    it("returns false on same-length mismatch", () => {
      const ok = provider.verifySignature(
        new Uint8Array(),
        "aaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbb",
      );
      expect(ok).toBe(false);
    });
  });

  describe("sendMessage", () => {
    it("returns success=false with the expected error string", async () => {
      const result = await provider.sendMessage(
        {
          id: "acc-1",
          tenantId: "t1",
          channel: "http",
          provider: "http",
          name: "HTTP ingest",
          externalId: "http-source-1",
          accessToken: "placeholder",
          isActive: true,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
        { to: "user-1", type: "text", text: "hello" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("outbound not supported for http channel");
      expect(typeof result.timestamp).toBe("string");
    });
  });
});
