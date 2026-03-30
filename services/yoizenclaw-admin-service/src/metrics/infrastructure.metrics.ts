import { Injectable } from "@nestjs/common";
import {
  globalMetricsRegistry,
  type MetricTags,
} from "./metrics.registry";

export type StreamMetricTags = {
  tenant: string;
  stream_name: string;
};

export type StreamStats = {
  bytes: number;
  messages: number;
  consumers: number;
};

@Injectable()
export class InfrastructureMetricsService {
  private readonly streamBytesGauge = globalMetricsRegistry.gauge(
    "nats.stream.bytes",
    "Current size of NATS JetStream stream in bytes",
  );

  private readonly streamMessagesGauge = globalMetricsRegistry.gauge(
    "nats.stream.messages",
    "Current message count in NATS JetStream stream",
  );

  private readonly streamConsumersGauge = globalMetricsRegistry.gauge(
    "nats.stream.consumers",
    "Current consumer count for NATS JetStream stream",
  );

  private readonly streamOperationsCounter = globalMetricsRegistry.counter(
    "nats.stream.operations",
    "Total NATS JetStream stream operations",
  );

  recordStreamStats(
    tags: StreamMetricTags,
    stats: StreamStats,
  ): void {
    const metricTags = tags as unknown as MetricTags;
    this.streamBytesGauge.record(stats.bytes, metricTags);
    this.streamMessagesGauge.record(stats.messages, metricTags);
    this.streamConsumersGauge.record(stats.consumers, metricTags);
  }

  recordStreamOperation(
    operation: string,
    tags: StreamMetricTags,
    success: boolean,
  ): void {
    this.streamOperationsCounter.increment({
      ...tags,
      operation,
      success: String(success),
    } as unknown as MetricTags);
  }
}
