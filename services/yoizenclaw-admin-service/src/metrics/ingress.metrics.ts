import { Injectable } from "@nestjs/common";
import {
  globalMetricsRegistry,
  type MetricTags,
} from "./metrics.registry";

export type AdminPublishTags = {
  tenant: string;
  channel?: string;
  provider?: string;
  event_type?: string;
};

@Injectable()
export class AdminMetricsService {
  private readonly publishedCounter = globalMetricsRegistry.counter(
    "admin.event.published",
    "Total admin events published",
  );

  private readonly publishFailedCounter = globalMetricsRegistry.counter(
    "admin.event.publish_failed",
    "Total admin event publish failures",
  );

  private readonly publishDurationHistogram = globalMetricsRegistry.histogram(
    "admin.event.publish_duration_ms",
    "Duration of admin event publishing in milliseconds",
  );

  private readonly payloadBytesHistogram = globalMetricsRegistry.histogram(
    "admin.event.payload_bytes",
    "Size of admin event payloads in bytes",
  );

  private readonly claimCheckInlineCounter = globalMetricsRegistry.counter(
    "admin.claimcheck.inline",
    "Events published inline without claim-check",
  );

  private readonly claimCheckStoredCounter = globalMetricsRegistry.counter(
    "admin.claimcheck.stored",
    "Events published using claim-check pattern",
  );

  recordPublished(tags: AdminPublishTags): void {
    this.publishedCounter.increment(tags as unknown as MetricTags);
  }

  recordPublishFailed(
    tags: AdminPublishTags,
    reason: string,
  ): void {
    this.publishFailedCounter.increment({
      ...tags,
      reason,
    } as unknown as MetricTags);
  }

  recordPublishDuration(
    durationMs: number,
    tags: AdminPublishTags,
    success: boolean,
  ): void {
    this.publishDurationHistogram.record(durationMs, {
      ...tags,
      success: String(success),
    } as unknown as MetricTags);
  }

  recordPayloadBytes(
    bytes: number,
    tags: AdminPublishTags,
  ): void {
    this.payloadBytesHistogram.record(bytes, tags as unknown as MetricTags);
  }

  recordClaimCheckInline(tags: AdminPublishTags): void {
    this.claimCheckInlineCounter.increment(tags as unknown as MetricTags);
  }

  recordClaimCheckStored(tags: AdminPublishTags): void {
    this.claimCheckStoredCounter.increment(tags as unknown as MetricTags);
  }
}
