import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { NatsConnection } from "nats";
import {
  WEBHOOK_VERIFY_RPC_SUBJECT,
  type ChannelAccount,
} from "@yoizen/shared";
import { __resetServiceModeCacheForTests } from "@yoizen/observability";
import { WebhookVerifyRpcServer } from "../../src/modules/webhooks/webhook-verify-rpc.server";
import type { AccountsService } from "../../src/modules/accounts/accounts.service";

describe("WebhookVerifyRpcServer", () => {
  const findByVerifyToken = mock(
    () => Promise.resolve(null as ChannelAccount | null),
  );
  const accounts = {
    findByVerifyToken,
  } as unknown as AccountsService;

  const unsubscribe = mock(() => undefined);
  const subscribe = mock(() => ({ unsubscribe }));
  const nc = {
    subscribe,
  } as unknown as NatsConnection;

  beforeEach(() => {
    process.env.SERVICE_MODE = "worker";
    __resetServiceModeCacheForTests();
    findByVerifyToken.mockClear();
    subscribe.mockClear();
    unsubscribe.mockClear();
  });

  it("subscribes to webhook verify RPC subject with queue group", async () => {
    const service = new WebhookVerifyRpcServer(nc, accounts);
    await service.onModuleInit();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(
      WEBHOOK_VERIFY_RPC_SUBJECT,
      expect.objectContaining({ queue: "channel-service.webhook-verify" }),
    );
  });

  it("responds with challenge when verify token matches", async () => {
    findByVerifyToken.mockImplementation(() =>
      Promise.resolve({ id: "acc-1" } as ChannelAccount),
    );
    const respond = mock(() => true);
    const msg = {
      data: new TextEncoder().encode(
        JSON.stringify({
          tenantId: "t1",
          channel: "whatsapp",
          verifyToken: "token-1",
          challenge: "abc123",
        }),
      ),
      respond,
    };

    const service = new WebhookVerifyRpcServer(nc, accounts);
    await (
      service as unknown as {
        handleMessage: (message: unknown) => Promise<void>;
      }
    ).handleMessage(msg);

    expect(findByVerifyToken).toHaveBeenCalledWith("t1", "whatsapp", "token-1");
    expect(respond).toHaveBeenCalledTimes(1);
    const [payload] = respond.mock.calls[0];
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    expect(parsed).toEqual({ ok: true, challenge: "abc123" });
  });

  it("responds invalid_token when token does not match", async () => {
    findByVerifyToken.mockImplementation(() => Promise.resolve(null));
    const respond = mock(() => true);
    const msg = {
      data: new TextEncoder().encode(
        JSON.stringify({
          tenantId: "t1",
          channel: "whatsapp",
          verifyToken: "bad",
          challenge: "abc123",
        }),
      ),
      respond,
    };

    const service = new WebhookVerifyRpcServer(nc, accounts);
    await (
      service as unknown as {
        handleMessage: (message: unknown) => Promise<void>;
      }
    ).handleMessage(msg);

    const [payload] = respond.mock.calls[0];
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    expect(parsed).toEqual({ ok: false, reason: "invalid_token" });
  });
});
