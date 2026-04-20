import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { JetStreamClient, JetStreamManager } from "nats";
import type { ChannelAccount, OutboundMessage } from "@yoizen/shared";
import { EgressService } from "../../src/modules/egress/egress.service";
import { ChannelRouter } from "../../src/providers/channel-router";
import { AccountsService } from "../../src/modules/accounts/accounts.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";
import { EGRESS_BREAKER } from "../../src/modules/egress/egress-breaker.provider";

describe("EgressService", () => {
  let service: EgressService;
  let publish: ReturnType<typeof mock>;

  beforeEach(async () => {
    publish = mock(() => Promise.resolve());

    const js = { publish } as unknown as JetStreamClient;

    const jsm = {
      streams: {
        info: mock(() => Promise.reject(new Error("stream not found"))),
        add: mock(() => Promise.resolve()),
      },
    } as unknown as JetStreamManager;

    const account: ChannelAccount = {
      id: "acc-1",
      tenantId: "t1",
      channel: "telegram",
      provider: "telegram",
      name: "bot",
      externalId: "ext",
      telegramBotToken: "tok",
      accessToken: "tok",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const accounts = {
      findById: mock(() => Promise.resolve(account)),
    };

    const sendMessage = mock(() =>
      Promise.resolve({
        success: true,
        providerMessageId: "pm-1",
        timestamp: new Date().toISOString(),
      }),
    );

    const router = {
      getOrThrow: mock(() => ({
        sendMessage,
      })),
    };

    const breaker = {
      canProceed: mock(() =>
        Promise.resolve({
          action: "allow" as const,
          status: "closed" as const,
          reason: "fresh",
        }),
      ),
      recordSuccess: mock(() => undefined),
      recordFailure: mock(() => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EgressService,
        { provide: JETSTREAM_PUBLISHER, useValue: js },
        { provide: JETSTREAM_MANAGER, useValue: jsm },
        { provide: ChannelRouter, useValue: router },
        { provide: AccountsService, useValue: accounts },
        { provide: EGRESS_BREAKER, useValue: breaker },
      ],
    }).compile();

    service = moduleRef.get(EgressService);
  });

  it("send resolves and shadow-publishes on success", async () => {
    const tenantId = crypto.randomUUID();
    const message: OutboundMessage = {
      to: "u1",
      type: "text",
      text: "hi",
    };

    const result = await service.send(tenantId, "acc-1", message);

    expect(result.success).toBe(true);
    expect(publish).toHaveBeenCalled();
  });
});
