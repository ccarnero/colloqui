import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { of } from "rxjs";
import { ChannelStreamService } from "../../src/modules/channels/channel-stream.service";
import { ChannelsController } from "../../src/modules/channels/channels.controller";
import { ChannelsProxyService } from "../../src/modules/channels/channels-proxy.service";

describe("ChannelsController", () => {
  let controller: ChannelsController;
  let proxy: ReturnType<typeof mock>;
  let streamSvc: { streamChannelEvents: ReturnType<typeof mock> };

  beforeEach(async () => {
    proxy = mock(() => Promise.resolve({ ok: true }));
    const streamChannelEvents = mock(() =>
      of({ data: JSON.stringify({ type: "ping" }) })
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

  const req = {
    tenantId: "tenant-1",
  } as import("../../src/types/yoizen-request").ITenantScopedRequest;

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

  it("listUsage forwards GET /channels/usage with query", async () => {
    await controller.listUsage(req, {
      from: "2026-04-20T00:00:00Z",
      to: "2026-04-23T00:00:00Z",
      bucket: "hour",
      accountId: "acct-1",
      channel: "whatsapp",
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/usage",
      tenantId: "tenant-1",
      query: expect.objectContaining({
        from: "2026-04-20T00:00:00Z",
        to: "2026-04-23T00:00:00Z",
        accountId: "acct-1",
        channel: "whatsapp",
        bucket: "hour",
      }),
    });
  });

  it("usageSummary forwards GET /channels/usage/summary", async () => {
    await controller.usageSummary(req);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/usage/summary",
      tenantId: "tenant-1",
    });
  });

  it("usageTotals forwards GET /channels/usage/totals", async () => {
    await controller.usageTotals(req, {
      from: "2026-04-20T00:00:00Z",
      to: "2026-04-23T00:00:00Z",
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/usage/totals",
      tenantId: "tenant-1",
      query: expect.objectContaining({
        from: "2026-04-20T00:00:00Z",
        to: "2026-04-23T00:00:00Z",
      }),
    });
  });

  it("listStreams forwards GET /channels/streams", async () => {
    await controller.listStreams(req);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/streams",
      tenantId: "tenant-1",
    });
  });

  it("streamMessages URL-encodes the key and forwards query", async () => {
    await controller.streamMessages(req, "ingress", {
      subject: "ingress.whatsapp.*",
      limit: 10,
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/streams/ingress/messages",
      tenantId: "tenant-1",
      query: expect.objectContaining({
        subject: "ingress.whatsapp.*",
        limit: 10,
      }),
    });
  });

  it("streamMessages forwards the mode query flag when provided", async () => {
    await controller.streamMessages(req, "ingress", {
      limit: 20,
      mode: "tail",
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/streams/ingress/messages",
      tenantId: "tenant-1",
      query: expect.objectContaining({
        limit: 20,
        mode: "tail",
      }),
    });
  });

  it("streamMessages forwards accountId when provided", async () => {
    await controller.streamMessages(req, "dlq", {
      subject: "dlq.t1.>",
      accountId: "7b0f2c27-792c-4345-b768-9e901eb7044f",
      limit: 15,
    } as never);
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/channels/streams/dlq/messages",
      tenantId: "tenant-1",
      query: expect.objectContaining({
        subject: "dlq.t1.>",
        accountId: "7b0f2c27-792c-4345-b768-9e901eb7044f",
        limit: 15,
      }),
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
