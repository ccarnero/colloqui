import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  GatewayTimeoutException,
  NotFoundException,
} from "@nestjs/common";
import type { NatsConnection } from "nats";
import { WEBHOOK_VERIFY_RPC_SUBJECT } from "@yoizen/shared";
import { WebhookVerifyRpcClient } from "../../src/modules/channels/webhook-verify-rpc.client";

describe("WebhookVerifyRpcClient", () => {
  const request = mock(() =>
    Promise.resolve({
      data: new TextEncoder().encode(
        JSON.stringify({ ok: true, challenge: "challenge-123" }),
      ),
    }),
  );
  const nc = { request } as unknown as NatsConnection;

  beforeEach(() => {
    request.mockClear();
  });

  it("returns challenge when channel-service verifies token", async () => {
    const client = new WebhookVerifyRpcClient(nc);
    const challenge = await client.verify({
      tenantId: "t1",
      channel: "whatsapp",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "token-1",
        "hub.challenge": "challenge-123",
      },
    });

    expect(challenge).toBe("challenge-123");
    expect(request).toHaveBeenCalledTimes(1);
    const [subject, payload] = request.mock.calls[0];
    expect(subject).toBe(WEBHOOK_VERIFY_RPC_SUBJECT);
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    expect(parsed).toEqual({
      tenantId: "t1",
      channel: "whatsapp",
      verifyToken: "token-1",
      challenge: "challenge-123",
    });
  });

  it("throws NotFoundException when token is invalid", async () => {
    request.mockImplementation(() =>
      Promise.resolve({
        data: new TextEncoder().encode(
          JSON.stringify({ ok: false, reason: "invalid_token" }),
        ),
      }),
    );
    const client = new WebhookVerifyRpcClient(nc);

    await expect(
      client.verify({
        tenantId: "t1",
        channel: "whatsapp",
        query: {
          "hub.mode": "subscribe",
          "hub.verify_token": "bad-token",
          "hub.challenge": "challenge-123",
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps timeout errors to GatewayTimeoutException", async () => {
    request.mockImplementation(() => Promise.reject(new Error("request timeout")));
    const client = new WebhookVerifyRpcClient(nc);

    await expect(
      client.verify({
        tenantId: "t1",
        channel: "whatsapp",
        query: {
          "hub.mode": "subscribe",
          "hub.verify_token": "token-1",
          "hub.challenge": "challenge-123",
        },
      }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });
});
