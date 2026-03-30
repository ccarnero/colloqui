import { Injectable, Inject, Logger } from "@nestjs/common";
import { StorageType, type JetStreamClient, type ObjectStore } from "nats";
import { JETSTREAM_CLIENT } from "./nats.provider";
import { checkPayloadSize } from "../utils/payload-utils";
import { CLAIM_CHECK_THRESHOLD_BYTES } from "@yoizen/shared";

@Injectable()
export class ClaimCheckService {
  private readonly logger = new Logger(ClaimCheckService.name);
  private readonly bucketCache = new Map<string, ObjectStore>();

  constructor(
    @Inject(JETSTREAM_CLIENT)
    private readonly js: JetStreamClient,
  ) {}

  checkSize(
    payload: Record<string, unknown>,
    threshold?: number,
  ): { inline: boolean; bytes: number } {
    const result = checkPayloadSize(
      payload,
      threshold ?? CLAIM_CHECK_THRESHOLD_BYTES,
    );
    return { inline: result.inline, bytes: result.bytes };
  }

  async storePayload(
    tenantId: string,
    eventId: string,
    payload: Record<string, unknown>,
  ): Promise<{ ref: string }> {
    const bucket = await this.getOrCreateBucket(tenantId);
    const key = `${eventId}-payload`;
    const data = new TextEncoder().encode(JSON.stringify(payload));

    try {
      await bucket.putBlob({ name: key }, data);
      const bucketName = `PAYLOAD-${tenantId}`;
      const ref = `nats://objstore/${bucketName}/${key}`;
      this.logger.log(
        `Stored payload for event '${eventId}' in bucket '${bucketName}' (${data.byteLength} bytes)`,
      );
      return { ref };
    } catch (error) {
      this.logger.error(
        `Failed to store payload for event '${eventId}' in Object Store`,
        error,
      );
      throw error;
    }
  }

  async ensureBucket(tenantId: string, ttl: number): Promise<void> {
    const bucketName = `PAYLOAD-${tenantId}`;
    if (this.bucketCache.has(bucketName)) return;

    try {
      const os = await this.js.views.os(bucketName, {
        ttl,
        storage: StorageType.File,
        max_bytes: 0,
        replicas: 1,
        placement: { cluster: "", tags: [] },
      });
      this.bucketCache.set(bucketName, os);
      this.logger.log(`Ensured Object Store bucket '${bucketName}'`);
    } catch (error) {
      this.logger.error(
        `Failed to ensure Object Store bucket '${bucketName}'`,
        error,
      );
      throw error;
    }
  }

  private async getOrCreateBucket(tenantId: string): Promise<ObjectStore> {
    const bucketName = `PAYLOAD-${tenantId}`;
    const cached = this.bucketCache.get(bucketName);
    if (cached) return cached;

    const os = await this.js.views.os(bucketName, {
      storage: StorageType.File,
      max_bytes: 0,
      replicas: 1,
      placement: { cluster: "", tags: [] },
    });
    this.bucketCache.set(bucketName, os);
    return os;
  }
}
