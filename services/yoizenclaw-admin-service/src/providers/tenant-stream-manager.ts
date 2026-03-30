import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  StorageType,
  RetentionPolicy,
  type JetStreamManager,
  type StreamInfo,
} from "nats";
import { JETSTREAM_MANAGER } from "./nats.provider";
import {
  type TenantTier,
  type TenantStreamConfig,
  buildTenantStreamConfig,
  getTenantStreamName,
  TIER_CONFIGS,
} from "../types/stream-config";

export interface StreamStats {
  bytes: number;
  messages: number;
  consumerCount: number;
}

@Injectable()
export class TenantStreamManager {
  private readonly logger = new Logger(TenantStreamManager.name);

  constructor(
    @Inject(JETSTREAM_MANAGER)
    private readonly jsm: JetStreamManager,
  ) {}

  async ensureTenantStream(
    tenantId: string,
    tier: TenantTier,
  ): Promise<{ success: boolean; action: "created" | "updated" | "existing" }> {
    const config = buildTenantStreamConfig(tenantId, tier);
    const streamName = config.name;

    try {
      const existing = await this.jsm.streams.info(streamName);
      const needsUpdate =
        existing.config.max_age !== config.limits.max_age ||
        existing.config.max_bytes !== config.limits.max_bytes ||
        existing.config.max_msg_size !== config.limits.max_msg_size ||
        existing.config.num_replicas !== config.limits.num_replicas;

      if (!needsUpdate) {
        return { success: true, action: "existing" };
      }

      await this.jsm.streams.update(streamName, {
        max_age: config.limits.max_age,
        max_bytes: config.limits.max_bytes,
        max_msg_size: config.limits.max_msg_size,
        num_replicas: config.limits.num_replicas,
        subjects: config.subjects,
      });
      this.logger.log(`Updated stream '${streamName}' for tier '${tier}'`);
      return { success: true, action: "updated" };
    } catch {
      await this.jsm.streams.add({
        name: streamName,
        subjects: config.subjects,
        max_age: config.limits.max_age,
        max_bytes: config.limits.max_bytes,
        max_msg_size: config.limits.max_msg_size,
        num_replicas: config.limits.num_replicas,
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
      });
      this.logger.log(`Created stream '${streamName}' for tier '${tier}'`);
      return { success: true, action: "created" };
    }
  }

  async deleteTenantStream(tenantId: string): Promise<boolean> {
    const streamName = getTenantStreamName(tenantId);
    try {
      return await this.jsm.streams.delete(streamName);
    } catch {
      this.logger.warn(`Stream '${streamName}' not found for deletion`);
      return false;
    }
  }

  async getStreamStats(tenantId: string): Promise<StreamStats | null> {
    const streamName = getTenantStreamName(tenantId);
    try {
      const info: StreamInfo = await this.jsm.streams.info(streamName);
      return {
        bytes: info.state.bytes,
        messages: info.state.messages,
        consumerCount: info.state.consumer_count,
      };
    } catch {
      return null;
    }
  }

  async verifyAndUpdateTier(
    tenantId: string,
    newTier: TenantTier,
  ): Promise<{ success: boolean; error?: string }> {
    const limits = TIER_CONFIGS[newTier];
    const streamName = getTenantStreamName(tenantId);

    try {
      await this.jsm.streams.info(streamName);
    } catch {
      return {
        success: false,
        error: `Stream '${streamName}' not found for tenant '${tenantId}'`,
      };
    }

    try {
      await this.jsm.streams.update(streamName, {
        max_age: limits.max_age,
        max_bytes: limits.max_bytes,
        max_msg_size: limits.max_msg_size,
        num_replicas: limits.num_replicas,
      });
      this.logger.log(
        `Updated stream '${streamName}' to tier '${newTier}'`,
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to update stream '${streamName}' tier: ${message}`,
      );
      return { success: false, error: message };
    }
  }
}
