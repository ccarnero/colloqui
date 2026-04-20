import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { JetStreamClient, JetStreamManager } from "nats";
import type { ChannelAccount, OutboundMessage } from "@yoizen/shared";
import { isPermanentError } from "@yoizen/shared";
import { EgressService } from "../../src/modules/egress/egress.service";
import { ChannelRouter } from "../../src/providers/channel-router";
import { AccountsService } from "../../src/modules/accounts/accounts.service";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../src/providers/nats.provider";
import { EGRESS_BREAKER } from "../../src/modules/egress/egress-breaker.provider";

/**
 * Verifies the per-(tenant, provider) circuit breaker contract:
 *  - A "deny" decision short-circuits before the provider is called.
 *  - The failure is surfaced as PermanentError → consumer TERMs to DLQ.
 *  - No shadow publish happens (no downstream cascades).
 *  - A failed upstream send is counted toward the breaker.
 */
describe("EgressService circuit breaker", () => {
  let publish: ReturnType<typeof mock>;
  let sendMessage: ReturnType<typeof mock>;
  let breaker: {
    canProceed: ReturnType<typeof mock>;
    recordSuccess: ReturnType<typeof mock>;
    recordFailure: ReturnType<typeof mock>;
  };
  let service: EgressService;

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

  const message: OutboundMessage = { to: "u1", type: "text", text: "hi" };

  beforeEach(async () => {
    publish = mock(() => Promise.resolve());
    sendMessage = mock(() =>
      Promise.resolve({
        success: true,
        providerMessageId: "pm-1",
        timestamp: new Date().toISOString(),
      }),
    );
    breaker = {
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
        {
          provide: JETSTREAM_PUBLISHER,
          useValue: { publish } as unknown as JetStreamClient,
        },
        {
          provide: JETSTREAM_MANAGER,
          useValue: {
            streams: {
              info: mock(() => Promise.reject(new Error("stream not found"))),
              add: mock(() => Promise.resolve()),
            },
          } as unknown as JetStreamManager,
        },
        {
          provide: ChannelRouter,
          useValue: { getOrThrow: mock(() => ({ sendMessage })) },
        },
        {
          provide: AccountsService,
          useValue: { findById: mock(() => Promise.resolve(account)) },
        },
        { provide: EGRESS_BREAKER, useValue: breaker },
      ],
    }).compile();
    service = moduleRef.get(EgressService);
  });

  it("fast-fails with PermanentError when breaker denies and does not call provider", async () => {
    breaker.canProceed = mock(() =>
      Promise.resolve({
        action: "deny" as const,
        status: "open" as const,
        reason: "cooldown",
      }),
    );
    // re-wire: grab a fresh service where canProceed returns deny
    const m = await Test.createTestingModule({
      providers: [
        EgressService,
        {
          provide: JETSTREAM_PUBLISHER,
          useValue: { publish } as unknown as JetStreamClient,
        },
        {
          provide: JETSTREAM_MANAGER,
          useValue: {
            streams: {
              info: mock(() => Promise.reject(new Error("stream not found"))),
              add: mock(() => Promise.resolve()),
            },
          } as unknown as JetStreamManager,
        },
        {
          provide: ChannelRouter,
          useValue: { getOrThrow: mock(() => ({ sendMessage })) },
        },
        {
          provide: AccountsService,
          useValue: { findById: mock(() => Promise.resolve(account)) },
        },
        { provide: EGRESS_BREAKER, useValue: breaker },
      ],
    }).compile();
    const svc = m.get(EgressService);

    let caught: unknown = null;
    try {
      await svc.send("tenant-a", "acc-1", message);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isPermanentError(caught)).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(0);
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it("records a failure on the breaker when the provider throws", async () => {
    sendMessage = mock(() => Promise.reject(new Error("provider-500")));
    const m = await Test.createTestingModule({
      providers: [
        EgressService,
        {
          provide: JETSTREAM_PUBLISHER,
          useValue: { publish } as unknown as JetStreamClient,
        },
        {
          provide: JETSTREAM_MANAGER,
          useValue: {
            streams: {
              info: mock(() => Promise.reject(new Error("stream not found"))),
              add: mock(() => Promise.resolve()),
            },
          } as unknown as JetStreamManager,
        },
        {
          provide: ChannelRouter,
          useValue: { getOrThrow: mock(() => ({ sendMessage })) },
        },
        {
          provide: AccountsService,
          useValue: { findById: mock(() => Promise.resolve(account)) },
        },
        { provide: EGRESS_BREAKER, useValue: breaker },
      ],
    }).compile();
    const svc = m.get(EgressService);

    let caught: unknown = null;
    try {
      await svc.send("tenant-a", "acc-1", message);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(breaker.recordFailure).toHaveBeenCalledTimes(1);
    expect(breaker.recordSuccess).toHaveBeenCalledTimes(0);
  });

  it("records success on the breaker when provider returns success", async () => {
    await service.send("tenant-a", "acc-1", message);
    expect(breaker.recordSuccess).toHaveBeenCalledTimes(1);
    expect(breaker.recordFailure).toHaveBeenCalledTimes(0);
  });

  it("records failure on the breaker when provider returns success=false", async () => {
    sendMessage = mock(() =>
      Promise.resolve({ success: false, errorReason: "nope" }),
    );
    const m = await Test.createTestingModule({
      providers: [
        EgressService,
        {
          provide: JETSTREAM_PUBLISHER,
          useValue: { publish } as unknown as JetStreamClient,
        },
        {
          provide: JETSTREAM_MANAGER,
          useValue: {
            streams: {
              info: mock(() => Promise.reject(new Error("stream not found"))),
              add: mock(() => Promise.resolve()),
            },
          } as unknown as JetStreamManager,
        },
        {
          provide: ChannelRouter,
          useValue: { getOrThrow: mock(() => ({ sendMessage })) },
        },
        {
          provide: AccountsService,
          useValue: { findById: mock(() => Promise.resolve(account)) },
        },
        { provide: EGRESS_BREAKER, useValue: breaker },
      ],
    }).compile();
    const svc = m.get(EgressService);

    const result = await svc.send("tenant-a", "acc-1", message);
    expect(result.success).toBe(false);
    expect(breaker.recordFailure).toHaveBeenCalledTimes(1);
    expect(breaker.recordSuccess).toHaveBeenCalledTimes(0);
  });
});
