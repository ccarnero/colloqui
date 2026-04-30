import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";

describe("IngressService", () => {
  let publish: ReturnType<typeof mock>;
  let putBlob: ReturnType<typeof mock>;
  let osFactory: ReturnType<typeof mock>;
  let jsm: import("nats").JetStreamManager;
  let js: {
    publish: typeof publish;
    views: { os: typeof osFactory };
  };

  beforeEach(() => {
    publish = mock(() => Promise.resolve({ seq: 1 }));
    putBlob = mock(() => Promise.resolve({ name: "", size: 0 }));
    osFactory = mock(() =>
      Promise.resolve({
        putBlob,
        getBlob: mock(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
      }),
    );
    js = {
      publish,
      views: { os: osFactory },
    };
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
        { provide: JETSTREAM_PUBLISHER, useValue: js },
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

  it("uses claim-check (Object Store + slim envelope) when payload exceeds threshold", async () => {
    const service = await compile();
    // Build a body large enough to blow past CLAIM_CHECK_THRESHOLD_BYTES (1 MiB default).
    const largeText = "x".repeat(1_100_000);
    await service.processInbound({
      tenantId: "tenant-a",
      channel: "whatsapp",
      provider: "meta",
      accountId: "acc-1",
      messages: [
        {
          messageId: "m-large",
          from: "+1",
          timestamp: `${Date.now()}`,
          type: "text",
          text: largeText,
          raw: {},
        },
      ],
    });

    // Object Store must be opened and the payload stored.
    expect(osFactory).toHaveBeenCalledTimes(1);
    expect(osFactory).toHaveBeenCalledWith(
      "PAYLOAD-tenant-a",
      expect.objectContaining({
        description: expect.stringContaining("tenant-a"),
      }),
    );
    expect(putBlob).toHaveBeenCalledTimes(1);

    // Exactly one slim publish carrying the claim-check reference.
    expect(publish).toHaveBeenCalledTimes(1);
    const [, slimBytes, opts] = publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string | undefined } },
    ];
    const slim = JSON.parse(new TextDecoder().decode(slimBytes));
    expect(slim.claimCheck).toBe(true);
    expect(slim.payload_ref).toMatch(
      /^nats:\/\/objstore\/PAYLOAD-tenant-a\/.+-payload$/,
    );
    expect(slim.payload_bytes).toBeGreaterThan(1_000_000);
    expect(slim.payload_checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(opts.headers.get("X-Claim-Check")).toBe(slim.payload_ref);
    expect(opts.headers.get("Nats-Msg-Id")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
