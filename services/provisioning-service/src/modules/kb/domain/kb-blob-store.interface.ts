// Port for the content-addressed blob store backing `file:` KB sources
// (SPEC.md decision 6). Concrete implementation is the per-tenant NATS
// Object Store `PAYLOAD-<tenant>` (DOCS/messaging/claim-check.md), keyed by
// `sha256:<hex>` rather than the claim-check pattern's `{envelopeId}-payload`
// key — KB blobs are content-addressed on purpose (the whole point of
// decision 6 is "unchanged content is never re-embedded", which only works
// if identical bytes always map to the identical key regardless of which
// apply run stored them).

import type { Result } from "../../../lib/result";

export interface IKbBlobStore {
  putBlob(
    tenantId: string,
    sha256: string,
    bytes: Buffer
  ): Promise<Result<void, string>>;

  getBlob(tenantId: string, sha256: string): Promise<Result<Buffer, string>>;
}

export const KB_BLOB_STORE = Symbol("KB_BLOB_STORE");

/** In-memory no-op for tests. */
export function createInMemoryKbBlobStore(): IKbBlobStore {
  const blobs = new Map<string, Buffer>();
  const key = (tenantId: string, sha256: string) => `${tenantId}::${sha256}`;
  return {
    async putBlob(tenantId, sha256, bytes) {
      blobs.set(key(tenantId, sha256), bytes);
      return { ok: true, value: undefined };
    },
    async getBlob(tenantId, sha256) {
      const found = blobs.get(key(tenantId, sha256));
      if (!found) {
        return { ok: false, error: `no blob stored for sha256='${sha256}'` };
      }
      return { ok: true, value: found };
    },
  };
}
