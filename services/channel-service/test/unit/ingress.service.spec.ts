import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";

describe("IngressService", () => {
  let publish: ReturnType<typeof mock>;
  let jsm: import("nats").JetStreamManager;

  beforeEach(() => {
    publish = mock(() => Promise.resolve({ seq: 1 }));
    jsm = {
      streams: {
        info: mock(() => Promise.resolve({ config: { name: "INGRESS-t1" } })),
        add: mock(() => Promise.resolve()),
      },
    } as unknown as import("nats").JetStreamManager;
  });

  async function compile() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IngressService,
        { provide: JETSTREAM_PUBLISHER, useValue: { publish } },
        { provide: JETSTREAM_MANAGER, useValue: jsm },
      ],
    }).compile();
    return moduleRef.get(IngressService);
  }

  it("processInbound publishes one JetStream message per inbound item", async () => {
    const service = await compile();
    await service.processInbound({
      tenantId: "tenant-a",
      channel: "whatsapp",
      provider: "meta",
      accountId: "acc-1",
      messages: [
        {
          messageId: "m-1",
          from: "+1",
          timestamp: `${Date.now()}`,
          type: "text",
          text: "hello",
          raw: {},
        },
      ],
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("processInbound completes with no publishes when messages empty", async () => {
    const service = await compile();
    await service.processInbound({
      tenantId: "tenant-a",
      channel: "whatsapp",
      provider: "meta",
      accountId: "acc-1",
      messages: [],
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
