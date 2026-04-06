import "reflect-metadata";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { of } from "rxjs";
import { ChannelsController } from "../../src/modules/channels/channels.controller";
import { ChannelsProxyService } from "../../src/modules/channels/channels-proxy.service";
import { ChannelStreamService } from "../../src/modules/channels/channel-stream.service";

describe("ChannelsController", () => {
  let controller: ChannelsController;
  let proxy: ReturnType<typeof mock>;
  let streamSvc: { streamChannelEvents: ReturnType<typeof mock> };

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ ok: true }));
    const streamChannelEvents = mock(() =>
      of({ data: JSON.stringify({ type: "ping" }) }),
    );
    streamSvc = { streamChannelEvents };
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [
        { provide: ChannelsProxyService, useValue: { proxy } },
        { provide: ChannelStreamService, useValue: streamSvc },
      ],
    }).compile();
    controller = moduleRef.get(ChannelsController);
  });

  const req = { tenantId: "tenant-1" } as import("../../src/types/yoizen-request").ITenantScopedRequest;

  it("createAccount forwards POST /channels/accounts", async () => {
    const body = { channel: "email" } as never;
    await controller.createAccount(req, body);
    expect(proxy).toHaveBeenCalledWith({
      method: "POST",
      path: "/channels/accounts",
      tenantId: "tenant-1",
      body: { channel: "email" },
    });
  });

  it("listAccounts passes channel query", async () => {
    await controller.listAccounts(req, { channel: "email" } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/accounts",
      tenantId: "tenant-1",
      query: { channel: "email" },
    });
  });

  it("stream delegates to ChannelStreamService with parsed kinds", async () => {
    const obs = controller.stream(req, { kinds: "a,b" } as never);
    expect(obs).toBeDefined();
    await new Promise<void>((resolve, reject) => {
      obs.subscribe({
        next: () => resolve(),
        error: reject,
        complete: () => resolve(),
      });
    });
    expect(streamSvc.streamChannelEvents).toHaveBeenCalledWith("tenant-1", [
      "a",
      "b",
    ]);
  });
});
