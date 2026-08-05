import { describe, expect, it } from "bun:test";
import type { ChannelAccount, OutboundMessage } from "@yoizen/shared";
import { E2eTestsProvider } from "../../src/providers/e2e-tests/e2e-tests.provider";

/**
 * The sink channel's contract is small but load-bearing in two directions, and
 * each direction is pinned here.
 *
 * OUTBOUND must SUCCEED: `EgressService` publishes `sent.v1` only inside
 * `if (result.success)`. If this provider ever regressed to a failure result,
 * the egress path would go silently uncovered again — the e2e's stage 19 would
 * fail, but only after a cluster round trip, so this pins it at unit level.
 *
 * INBOUND must be CLOSED: this channel ships in every deployment. A permissive
 * `verifySignature` would make it an unauthenticated ingress path, so the deny
 * is asserted rather than assumed.
 */
describe("E2eTestsProvider", () => {
  const provider = new E2eTestsProvider();
  const account = {
    id: "acc-1",
    tenantId: "acme",
  } as unknown as ChannelAccount;
  const message: OutboundMessage = { to: "someone", type: "text", text: "hi" };

  it("declares the e2e-tests channel and provider tokens", () => {
    expect(provider.channel).toBe("e2e-tests");
    expect(provider.provider).toBe("e2e-tests");
  });

  it("succeeds the send so EgressService reaches its publish branch", async () => {
    const result = await provider.sendMessage(account, message);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(typeof result.timestamp).toBe("string");
  });

  it("returns a distinct providerMessageId per send", async () => {
    const first = await provider.sendMessage(account, message);
    const second = await provider.sendMessage(account, message);
    expect(first.providerMessageId).toBeDefined();
    expect(first.providerMessageId).not.toBe(second.providerMessageId);
  });

  it("parses no inbound messages — it is outbound-only", () => {
    expect(provider.parseWebhook({ from: "someone", text: "hi" })).toEqual([]);
  });

  it("always denies signature verification, even when signature equals secret", () => {
    const body = new TextEncoder().encode("{}");
    // The permissive case a naive stub would accept: identical strings.
    expect(provider.verifySignature(body, "same-token", "same-token")).toBe(
      false
    );
  });
});
