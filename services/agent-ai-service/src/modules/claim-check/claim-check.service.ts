import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, ObjectStore } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import { JETSTREAM } from "../../providers/nats.provider";

/** 256 KB — payloads above this go to NATS Object Store. */
const CLAIM_CHECK_THRESHOLD_BYTES = 262_144;

/** URI scheme prefix for claim-check references. */
const OBJSTORE_REF_PREFIX = "nats://objstore/";

@Injectable()
export class ClaimCheckService {
  private readonly logger = new PinoLoggerService(ClaimCheckService.name);

  /** Lazily initialised Object Store handles keyed by bucket name. */
  private readonly storeCache = new Map<string, ObjectStore>();

  constructor(@Inject(JETSTREAM) private readonly js: JetStreamClient) {}

  // ---------------------------------------------------------------------------
  // checkPayloadSize
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a payload should travel inline or be claim-checked.
   *
   * Matches the Python `check_payload_size` contract: returns `{ inline, bytes }`.
   */
  checkPayloadSize(payload: Buffer | Uint8Array): {
    inline: boolean;
    bytes: number;
  } {
    const bytes = Buffer.byteLength(payload);
    const inline = bytes <= CLAIM_CHECK_THRESHOLD_BYTES;
    return { inline, bytes };
  }

  // ---------------------------------------------------------------------------
  // storePayload
  // ---------------------------------------------------------------------------

  /**
   * Store payload in a per-tenant NATS Object Store bucket.
   *
   * Bucket name: `PAYLOAD-{tenantId}`
   * Key:         `{eventId}-payload`
   *
   * Returns a reference URI: `nats://objstore/PAYLOAD-{tenantId}/{eventId}-payload`
   */
  async storePayload(
    tenantId: string,
    eventId: string,
    payload: Buffer,
  ): Promise<string> {
    const bucket = `PAYLOAD-${tenantId}`;
    const key = `${eventId}-payload`;
    const ref = `${OBJSTORE_REF_PREFIX}${bucket}/${key}`;

    try {
      const os = await this.getOrCreateStore(bucket);
      await os.putBlob({ name: key }, new Uint8Array(payload));

      this.logger.debug(
        `[claim-check] Stored payload: bucket='${bucket}' key='${key}' bytes=${payload.byteLength}`,
      );

      return ref;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[claim-check] Failed to store payload: bucket='${bucket}' key='${key}': ${msg}`,
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // resolvePayload
  // ---------------------------------------------------------------------------

  /**
   * Retrieve payload, either inline or from Object Store with SHA-256
   * checksum verification.
   *
   * When `payloadInline` is `true` (or undefined), returns `payload` directly.
   * Otherwise fetches from Object Store using `payloadRef` and verifies
   * `payloadChecksum` matches `sha256:<hex>`.
   */
  async resolvePayload(data: {
    payloadInline?: boolean;
    payload?: Buffer;
    payloadRef?: string;
    payloadChecksum?: string;
  }): Promise<Buffer> {
    if (data.payloadInline !== false) {
      return data.payload ?? Buffer.alloc(0);
    }

    const ref = data.payloadRef;
    if (!ref) {
      throw new Error(
        "[claim-check] payload_ref missing for non-inline event",
      );
    }

    const { bucket, key } = this.parseRef(ref);

    let raw: Uint8Array;
    try {
      const os = await this.getOrCreateStore(bucket);
      const blob = await os.getBlob(key);
      if (!blob) {
        throw new Error(
          `[claim-check] Object not found: bucket='${bucket}' key='${key}'`,
        );
      }
      raw = blob;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[claim-check] Failed to resolve payload from ref='${ref}': ${msg}`,
      );
      throw error;
    }

    const checksum = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    const expected = data.payloadChecksum ?? "";
    if (checksum !== expected) {
      throw new Error(
        `[claim-check] Checksum mismatch: expected '${expected}', got '${checksum}'`,
      );
    }

    return Buffer.from(raw);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse a claim-check reference URI into bucket and key.
   *
   * Expected format: `nats://objstore/<bucket>/<key>`
   */
  private parseRef(ref: string): { bucket: string; key: string } {
    if (!ref.startsWith(OBJSTORE_REF_PREFIX)) {
      throw new Error(
        `[claim-check] Invalid payload_ref format: '${ref}' (expected '${OBJSTORE_REF_PREFIX}<bucket>/<key>')`,
      );
    }

    const path = ref.slice(OBJSTORE_REF_PREFIX.length);
    const slashIdx = path.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(
        `[claim-check] Invalid payload_ref format: '${ref}' (missing key after bucket)`,
      );
    }

    return {
      bucket: path.slice(0, slashIdx),
      key: path.slice(slashIdx + 1),
    };
  }

  /**
   * Lazily obtain (or create) a NATS Object Store for the given bucket name.
   *
   * The NATS client's `views.os()` call is idempotent — it returns the
   * existing store if one already exists, or creates it otherwise.
   */
  private async getOrCreateStore(bucket: string): Promise<ObjectStore> {
    const cached = this.storeCache.get(bucket);
    if (cached) return cached;

    const os = await this.js.views.os(bucket);
    this.storeCache.set(bucket, os);
    return os;
  }
}
