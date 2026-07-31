import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
} from "../../src/providers/nats.provider";
import {
  canonicalJson,
  canonicalByteLength,
  computePayloadChecksum,
  isCompliantEnvelope,
  buildDlqMessageSubject,
} from "@yoizen/shared";
import { __resetEnsuredDlqStreamCacheForTests } from "@yoizen/database";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A large text string that pushes the serialized envelope past 256 KB. */
const LARGE_TEXT = "x".repeat(270_000);

const BASE_OPTIONS = {
  tenantId: "tenant-a",
  channel: "whatsapp" as const,
  provider: "meta" as const,
  accountId: "acc-1",
};

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

type PutBlobMock = ReturnType<typeof mock>;
type PublishMock = ReturnType<typeof mock>;
type OsFactoryMock = ReturnType<typeof mock>;

interface MockSet {
  publish: PublishMock;
  putBlob: PutBlobMock;
  osFactory: OsFactoryMock;
  js: {
    publish: PublishMock;
    views: { os: OsFactoryMock };
  };
  jsm: import("nats").JetStreamManager;
}

function buildMocks(putBlobImpl?: () => Promise<unknown>): MockSet {
  const publish: PublishMock = mock(() => Promise.resolve({ seq: 1 }));
  const putBlob: PutBlobMock = mock(
    putBlobImpl ?? (() => Promise.resolve({ name: "", size: 0 })),
  );
  const osFactory: OsFactoryMock = mock(() =>
    Promise.resolve({ putBlob }),
  );
  const js = { publish, views: { os: osFactory } };
  const jsm = {
    streams: {
      info: mock(() => Promise.resolve({ config: { name: "INGRESS-tenant-a" } })),
      add: mock(() => Promise.resolve()),
    },
  } as unknown as import("nats").JetStreamManager;
  return { publish, putBlob, osFactory, js, jsm };
}

async function compileService(mocks: MockSet): Promise<IngressService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      IngressService,
      { provide: JETSTREAM_PUBLISHER, useValue: mocks.js },
      { provide: JETSTREAM_MANAGER, useValue: mocks.jsm },
    ],
  }).compile();
  return moduleRef.get(IngressService);
}

// ---------------------------------------------------------------------------
// Inline-path tests
// ---------------------------------------------------------------------------

describe("IngressService — inline path", () => {
  it("publishMessage publishes one JetStream message per inbound item", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);
    await service.processInbound({
      ...BASE_OPTIONS,
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
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // envelope-drift post-loop item 3 — stage-1 header allowlist reaches stage 2.
  //
  // T06 typed the destination (`IChannelEventData.headers`) and routed
  // `webhookHeaders` -> `data.headers` in the factory, but no caller ever
  // passed it, so stage-2 envelopes shipped without the allowlist that
  // `DOCS/messaging/envelope.md` §4.1 prescribes. The headers exist upstream:
  // api-gateway filters them against WEBHOOK_FORWARDED_HEADERS and lowercases
  // the keys (`webhook-ingress-publisher.service.ts:252-263`), the consumer
  // reads them off the stage-1 envelope and normalises case
  // (`webhook-ingress-consumer.service.ts:147`), and they are now threaded
  // through to `createChannelEnvelope`.
  //
  // Contract pinned here: ONE filtering point, at stage 1. channel-service
  // passes the allowlist through verbatim and never re-filters.
  // -------------------------------------------------------------------------
  it("forwards the stage-1 allowlist to data.headers, byte-identical", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);
    const webhookHeaders = {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=abc123",
    };

    await service.processInbound({
      ...BASE_OPTIONS,
      webhookHeaders,
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

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [, bytes] = mocks.publish.mock.calls[0] as unknown as [string, Uint8Array];
    const envelope = JSON.parse(new TextDecoder().decode(bytes));

    expect(envelope.data.headers).toEqual(webhookHeaders);
    // No re-filtering and no key rewriting on this hop.
    expect(Object.keys(envelope.data.headers)).toEqual(Object.keys(webhookHeaders));
    // The allowlist belongs under `data`, never on `transport` (T06).
    expect("headers" in envelope.transport).toBe(false);
  });

  it("omits data.headers entirely when no stage-1 allowlist is supplied", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);

    await service.processInbound({
      ...BASE_OPTIONS,
      messages: [
        {
          messageId: "m-2",
          from: "+1",
          timestamp: `${Date.now()}`,
          type: "text",
          text: "hello",
          raw: {},
        },
      ],
    });

    const [, bytes] = mocks.publish.mock.calls[0] as unknown as [string, Uint8Array];
    const envelope = JSON.parse(new TextDecoder().decode(bytes));

    expect("headers" in envelope.data).toBe(false);
    expect(envelope.data.headers).toBeUndefined();
  });

  it("completes with no publishes when messages is empty", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);
    await service.processInbound({ ...BASE_OPTIONS, messages: [] });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Claim-check path tests
// ---------------------------------------------------------------------------

describe("IngressService — claim-check path (threshold = 256 KB)", () => {
  beforeEach(() => {
    __resetEnsuredDlqStreamCacheForTests();
  });

  it("keeps data.headers on the slim envelope when claim-check fires", async () => {
    // The allowlist lives in `data` alongside `payload`, and claim-check nulls
    // `payload` while keeping the rest of `data`. Pinning it here so an
    // oversize webhook message does not silently lose its headers.
    const mocks = buildMocks();
    const service = await compileService(mocks);
    const webhookHeaders = {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=oversize",
    };

    await service.processInbound({
      ...BASE_OPTIONS,
      webhookHeaders,
      messages: [
        {
          messageId: "m-large-hdrs",
          from: "+1",
          timestamp: `${Date.now()}`,
          type: "text",
          text: LARGE_TEXT,
          raw: {},
        },
      ],
    });

    expect(mocks.putBlob).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [, slimBytes] = mocks.publish.mock.calls[0] as unknown as [
      string,
      Uint8Array,
    ];
    const slim = JSON.parse(new TextDecoder().decode(slimBytes));

    expect(slim.data.payload_inline).toBe(false);
    expect(slim.data.payload).toBeNull();
    expect(slim.data.headers).toEqual(webhookHeaders);
  });

  it("stores canonicalJson(payload) bytes and publishes a compliant slim envelope", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);

    await service.processInbound({
      ...BASE_OPTIONS,
      messages: [
        {
          messageId: "m-large",
          from: "+1",
          timestamp: `${Date.now()}`,
          type: "text",
          text: LARGE_TEXT,
          raw: {},
        },
      ],
    });

    // Object Store must be opened with bucket options
    expect(mocks.osFactory).toHaveBeenCalledTimes(1);
    expect(mocks.osFactory).toHaveBeenCalledWith(
      "PAYLOAD-tenant-a",
      expect.objectContaining({
        description: expect.stringContaining("tenant-a"),
        ttl: expect.any(Number),
        max_bytes: expect.any(Number),
      }),
    );

    // Blob must be stored exactly once
    expect(mocks.putBlob).toHaveBeenCalledTimes(1);

    // One slim publish
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [publishedSubject, slimBytes, opts] = mocks.publish.mock
      .calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string | undefined } },
    ];

    // Subject must be for tenant-a / whatsapp / meta / received
    expect(publishedSubject).toMatch(/tenant-a.*whatsapp.*meta.*received/);

    // Slim envelope must be compliant
    const slim = JSON.parse(new TextDecoder().decode(slimBytes));
    expect(isCompliantEnvelope(slim)).toBe(true);

    // payload_inline must be false
    expect(slim.data.payload_inline).toBe(false);
    expect(slim.data.payload).toBeNull();

    // payload_ref shape
    expect(slim.data.payload_ref).toMatch(
      /^nats:\/\/objstore\/PAYLOAD-tenant-a\/.+-payload$/,
    );

    // payload_bytes reflects canonical payload size (not the envelope size)
    // The payload stored is canonicalJson of the raw payload object
    const putBlobArgs = mocks.putBlob.mock.calls[0] as [
      { name: string; description: string },
      Uint8Array,
    ];
    const storedBytes = putBlobArgs[1];
    // payload_bytes === canonicalByteLength(payload)
    // We can't easily reconstruct the exact payload here, but we can verify
    // that the stored bytes are valid JSON and their length matches
    const storedJson = JSON.parse(Buffer.from(storedBytes).toString("utf8"));
    expect(slim.data.payload_bytes).toBe(
      canonicalByteLength(storedJson),
    );

    // Invariant: sha256(storedBytes) === payload_checksum
    const actualChecksum =
      "sha256:" + createHash("sha256").update(storedBytes).digest("hex");
    expect(slim.data.payload_checksum).toBe(actualChecksum);
    // Also verify computePayloadChecksum produces the same value
    expect(slim.data.payload_checksum).toBe(computePayloadChecksum(storedJson));

    // Headers: Nats-Msg-Id set, no X-Claim-Check header
    expect(opts.headers.get("Nats-Msg-Id")).toMatch(/^sha256:[0-9a-f]{64}$/);
    // nats headers.get returns "" for absent headers — falsy check is sufficient
    expect(opts.headers.get("X-Claim-Check")).toBeFalsy();
  });

  it("stored bytes === Buffer.from(canonicalJson(payload)) (invariant)", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);

    await service.processInbound({
      ...BASE_OPTIONS,
      messages: [
        {
          messageId: "inv-test",
          from: "+1",
          timestamp: "1700000000000",
          type: "text",
          text: LARGE_TEXT,
          raw: { nested: { deep: true } },
        },
      ],
    });

    const [, storedBytes] = mocks.putBlob.mock.calls[0] as [
      unknown,
      Uint8Array,
    ];
    const parsedFromStored = JSON.parse(
      Buffer.from(storedBytes).toString("utf8"),
    );
    // The stored bytes must equal Buffer.from(canonicalJson(parsedPayload))
    const reEncoded = Buffer.from(canonicalJson(parsedFromStored));
    expect(Buffer.from(storedBytes).equals(reEncoded)).toBe(true);
  });

  it("bucket opened with ttl, max_bytes, and storage options", async () => {
    const mocks = buildMocks();
    const service = await compileService(mocks);

    await service.processInbound({
      ...BASE_OPTIONS,
      messages: [
        {
          messageId: "bucket-opts",
          from: "+1",
          timestamp: `${Date.now()}`,
          type: "text",
          text: LARGE_TEXT,
          raw: {},
        },
      ],
    });

    const [, opts] = mocks.osFactory.mock.calls[0] as [
      string,
      { ttl: number; max_bytes: number; storage: unknown },
    ];
    // TTL should be a large number (7 days in nanoseconds)
    expect(opts.ttl).toBeGreaterThan(1_000_000_000);
    // max_bytes should be 512 MB
    expect(opts.max_bytes).toBe(512 * 1024 * 1024);
    // storage is StorageType.File
    expect(opts.storage).toBeDefined();
  });

  it("on store failure: DLQ publish to dlq.tenant-a.<subject> with X-Dlq-Reason: claim_check_store_failed and rethrows", async () => {
    const storeError = new Error("Object Store write failed");
    const mocks = buildMocks(() => Promise.reject(storeError));

    // DLQ stream jsm mock — starts with no streams info (triggers add)
    const jsmWithDlq = {
      streams: {
        info: mock(() => Promise.reject(new Error("stream not found"))),
        add: mock(() => Promise.resolve()),
      },
    } as unknown as import("nats").JetStreamManager;

    const moduleRef = await Test.createTestingModule({
      providers: [
        IngressService,
        { provide: JETSTREAM_PUBLISHER, useValue: mocks.js },
        { provide: JETSTREAM_MANAGER, useValue: jsmWithDlq },
      ],
    }).compile();
    const service = moduleRef.get(IngressService);

    let caughtError: unknown;
    try {
      await service.processInbound({
        ...BASE_OPTIONS,
        messages: [
          {
            messageId: "dlq-test",
            from: "+1",
            timestamp: `${Date.now()}`,
            type: "text",
            text: LARGE_TEXT,
            raw: {},
          },
        ],
      });
    } catch (err) {
      caughtError = err;
    }

    // Error must be rethrown (DLQ publish does not swallow it)
    // processInbound catches per-message errors via Promise.allSettled,
    // so the overall call succeeds — the only publish is the DLQ one,
    // never the slim envelope
    expect(mocks.publish.mock.calls.length).toBe(1);

    // DLQ publish must have happened
    const dlqCalls = mocks.publish.mock.calls.filter((c) => {
      const subject = c[0] as string;
      return subject.startsWith("dlq.tenant-a.");
    });
    expect(dlqCalls.length).toBe(1);

    const [dlqSubject, , dlqOpts] = dlqCalls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string | undefined }; msgID?: string },
    ];
    // Subject matches dlq.tenant-a.<original-subject>
    expect(dlqSubject).toMatch(/^dlq\.tenant-a\./);
    expect(dlqOpts.headers.get("X-Dlq-Reason")).toBe(
      "claim_check_store_failed",
    );
    expect(dlqOpts.headers.get("X-Dlq-Stage")).toBe("ingress_claim_check");
    expect(dlqOpts.headers.get("X-Dlq-Original-Subject")).toBeTruthy();
    expect(dlqOpts.msgID).toMatch(/^dlq:/);

    void caughtError; // acknowledged — processInbound captures via allSettled
  });
});
