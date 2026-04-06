import { describe, it, expect } from "bun:test";
import { createHmac } from "crypto";
import { verifyWebhookSignature } from "../../src/providers/meta/meta-base";

describe("meta-base verifyWebhookSignature", () => {
  it("returns true for valid sha256 HMAC", () => {
    const secret = "app-secret";
    const body = Buffer.from('{"entry":[]}');
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("returns false when signature length mismatches", () => {
    const body = Buffer.from("x");
    expect(verifyWebhookSignature(body, "short", "s")).toBe(false);
  });
});
