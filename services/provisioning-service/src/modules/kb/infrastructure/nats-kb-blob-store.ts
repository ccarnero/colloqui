// `IKbBlobStore` backed by the per-tenant NATS Object Store `PAYLOAD-<tenant>`
// (DOCS/messaging/claim-check.md §4) — reused for T06's content-addressed KB
// blobs. Key convention is `sha256:<hex>` (NOT the claim-check pattern's
// `{envelopeId}-payload`): KB blobs are addressed by content on purpose, so
// identical bytes uploaded by different apply runs map to the SAME key.

import { PinoLoggerService } from "@yoizen/observability";
import {
  buildClaimCheckBucket,
  CLAIM_CHECK_BUCKET_MAX_BYTES,
  CLAIM_CHECK_BUCKET_TTL_NS,
} from "@yoizen/shared";
import type { JetStreamClient, ObjectStore } from "nats";
import { err, ok, type Result } from "../../../lib/result";
import type { IKbBlobStore } from "../domain/kb-blob-store.interface";

function blobKey(sha256: string): string {
  return `sha256:${sha256}`;
}

export function createNatsKbBlobStore(js: JetStreamClient): IKbBlobStore {
  const logger = new PinoLoggerService("kb.blob-store");
  const ensuredBuckets = new Set<string>();

  async function getStore(tenantId: string): Promise<ObjectStore> {
    const bucket = buildClaimCheckBucket(tenantId);
    // Same bucket + sizing convention as the claim-check pattern
    // (DOCS/messaging/claim-check.md §4.2) — KB blobs and channel-envelope
    // payloads share one per-tenant Object Store, distinguished by key
    // convention only (`sha256:<hex>` vs `{envelopeId}-payload`).
    const store = await js.views.os(bucket, {
      ttl: CLAIM_CHECK_BUCKET_TTL_NS,
      max_bytes: CLAIM_CHECK_BUCKET_MAX_BYTES,
    });
    if (!ensuredBuckets.has(bucket)) {
      ensuredBuckets.add(bucket);
      logger.log(`blob-store: using bucket='${bucket}' tenant='${tenantId}'`);
    }
    return store;
  }

  return {
    async putBlob(tenantId, sha256, bytes): Promise<Result<void, string>> {
      try {
        const store = await getStore(tenantId);
        await store.put({ name: blobKey(sha256) }, streamOf(bytes));
        return ok(undefined);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        logger.warn(
          `blob-store: putBlob FAILED tenant='${tenantId}' sha256='${sha256}': ${message}`
        );
        return err(message);
      }
    },

    async getBlob(tenantId, sha256): Promise<Result<Buffer, string>> {
      try {
        const store = await getStore(tenantId);
        const raw = await store.getBlob(blobKey(sha256));
        if (!raw) {
          return err(`no blob stored for sha256='${sha256}'`);
        }
        return ok(Buffer.from(raw));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        logger.warn(
          `blob-store: getBlob FAILED tenant='${tenantId}' sha256='${sha256}': ${message}`
        );
        return err(message);
      }
    },
  };
}

function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}
