import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  computePayloadChecksum,
  canonicalByteLength,
} from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";
import type { ObjectStore } from "nats";
import {
  resolveClaimCheckEnvelope,
  ClaimCheckResolveError,
  looksLikeClaimCheck,
  parseClaimCheckRef,
} from "../../src/claim-check";

// ---------------------------------------------------------------------------
// In-memory fake ObjectStore
// ---------------------------------------------------------------------------

function fakeStore(blobs: Map<string, Uint8Array>): ObjectStore {
  return {
    getBlob: async (name: string) => blobs.get(name) ?? null,
  } as unknown as ObjectStore;
}

// ---------------------------------------------------------------------------
// Helpers: produce a claim-check envelope the same way the producer does
// ---------------------------------------------------------------------------

function makePayload(): Record<string, unknown> {
  return {
    messageId: "msg-abc",
    from: "+15551234567",
    timestamp: "1700000000000",
    type: "text",
    text: "hello world",
    raw: { nested: { deep: 42 } },
  };
}

function produceClaimCheckEnvelope(payload: Record<string, unknown>): {
  envelope: EventEnvelope;
  storedBytes: Uint8Array;
  bucket: string;
  key: string;
} {
  const canonicalBytes = Buffer.from(canonicalJson(payload));
  const checksum = computePayloadChecksum(payload);
  const bucket = "PAYLOAD-tenant-a";
  const key = "01JQXXXX-payload";
  const payloadRef = `nats://objstore/${bucket}/${key}`;

  const envelope: EventEnvelope = {
    specversion: "1.0",
    id: "01JQXXXX",
    source: "channel-service/accounts/acc-1",
    type: "io.yoizen.messaging.whatsapp.meta.received.v1",
    resource: "tenant/tenant-a/account/acc-1/channel/whatsapp/provider/meta",
    time: new Date().toISOString(),
    traceid: "abc123",
    causation_id: null,
    correlation_id: "corr-1",
    tenant: "tenant-a",
    producer: "channel-service",
    domain: "messaging",
    channel: "whatsapp",
    provider: "meta",
    accountid: "acc-1",
    idempotencykey: "sha256:aabbcc",
    transport: { method: "webhook", protocol: "https", depth: 0 },
    data: {
      received_at: new Date().toISOString(),
      payload_inline: false,
      payload_ref: payloadRef,
      payload_bytes: canonicalByteLength(payload),
      payload_checksum: checksum,
      payload: null,
    },
  };

  return { envelope, storedBytes: canonicalBytes, bucket, key };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("claim-check round-trip", () => {
  it("resolves an envelope and produces a payload deep-equal to the original", async () => {
    const payload = makePayload();
    const { envelope, storedBytes, bucket, key } =
      produceClaimCheckEnvelope(payload);

    const blobs = new Map([[key, storedBytes]]);
    const getStore = async (b: string) => {
      expect(b).toBe(bucket);
      return fakeStore(blobs);
    };

    const inflated = await resolveClaimCheckEnvelope(envelope, getStore);

    expect(inflated.data.payload_inline).toBe(true);
    expect(inflated.data.payload_ref).toBeNull();
    expect(inflated.data.payload).toEqual(payload);
  });

  it("verifies sha256 over the raw stored bytes matches payload_checksum", async () => {
    const payload = makePayload();
    const canonicalBytes = Buffer.from(canonicalJson(payload));
    // Checksum computed the same way the producer does
    const expectedChecksum =
      "sha256:" + createHash("sha256").update(canonicalBytes).digest("hex");

    expect(computePayloadChecksum(payload)).toBe(expectedChecksum);

    const { envelope, storedBytes, bucket, key } =
      produceClaimCheckEnvelope(payload);
    // stored bytes are the canonical bytes
    expect(Buffer.from(storedBytes).equals(canonicalBytes)).toBe(true);

    const blobs = new Map([[key, storedBytes]]);
    const inflated = await resolveClaimCheckEnvelope(
      envelope,
      async () => fakeStore(blobs),
    );
    expect(inflated.data.payload_checksum).toBe(expectedChecksum);
  });

  it("throws checksum_mismatch when stored bytes are tampered", async () => {
    const payload = makePayload();
    const { envelope, key } = produceClaimCheckEnvelope(payload);
    const tampered = Buffer.from("tampered data");
    const blobs = new Map([[key, tampered]]);

    await expect(
      resolveClaimCheckEnvelope(envelope, async () => fakeStore(blobs)),
    ).rejects.toMatchObject({ code: "checksum_mismatch" });
  });

  it("throws blob_not_found when the blob is absent", async () => {
    const payload = makePayload();
    const { envelope } = produceClaimCheckEnvelope(payload);
    const emptyStore = fakeStore(new Map());

    await expect(
      resolveClaimCheckEnvelope(envelope, async () => emptyStore),
    ).rejects.toMatchObject({ code: "blob_not_found" });
  });

  it("throws ref_missing when payload_ref is null", async () => {
    const payload = makePayload();
    const { envelope } = produceClaimCheckEnvelope(payload);
    const noRef = { ...envelope, data: { ...envelope.data, payload_ref: null } };

    await expect(
      resolveClaimCheckEnvelope(
        noRef as EventEnvelope,
        async () => fakeStore(new Map()),
      ),
    ).rejects.toMatchObject({ code: "ref_missing" });
  });

  it("throws ref_malformed for a bad URI", async () => {
    const payload = makePayload();
    const { envelope } = produceClaimCheckEnvelope(payload);
    const badRef = {
      ...envelope,
      data: { ...envelope.data, payload_ref: "not-a-valid-ref" },
    };

    await expect(
      resolveClaimCheckEnvelope(
        badRef as EventEnvelope,
        async () => fakeStore(new Map()),
      ),
    ).rejects.toMatchObject({ code: "ref_malformed" });
  });
});

describe("looksLikeClaimCheck", () => {
  it("returns true for bytes containing the marker", () => {
    const bytes = Buffer.from('{"payload_inline":false,"payload_ref":"nats://"}');
    expect(looksLikeClaimCheck(new Uint8Array(bytes))).toBe(true);
  });

  it("returns false for inline envelope bytes", () => {
    const bytes = Buffer.from('{"payload_inline":true,"payload":{"x":1}}');
    expect(looksLikeClaimCheck(new Uint8Array(bytes))).toBe(false);
  });

  it("returns false for garbage bytes", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    expect(looksLikeClaimCheck(bytes)).toBe(false);
  });
});

describe("parseClaimCheckRef", () => {
  it("parses a valid ref", () => {
    const ref = parseClaimCheckRef(
      "nats://objstore/PAYLOAD-tenant-a/01JQ-payload",
    );
    expect(ref).toEqual({ bucket: "PAYLOAD-tenant-a", key: "01JQ-payload" });
  });

  it("returns null for an invalid ref", () => {
    expect(parseClaimCheckRef("not-valid")).toBeNull();
    expect(parseClaimCheckRef("nats://objstore/")).toBeNull();
  });
});
