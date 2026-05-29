import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";

type UsageAggregatorServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  /** Base URL of tenant-service (used to discover live tenants). */
  readonly tenantServiceUrl: string;
  /** Polling interval for tenant-list refresh, in ms. */
  readonly tenantDiscoveryIntervalMs: number;
  /** Batch size before flushing to the usage store. */
  readonly batchSize: number;
  /** Hard ceiling on how long a batch can wait before being flushed, in ms. */
  readonly batchFlushMs: number;
  /** Durable consumer name used across every tenant INGRESS stream. */
  readonly ingressDurableName: string;
  /** Durable consumer name used across every tenant DLQ stream. */
  readonly dlqDurableName: string;
};

/** Lazy getters so tests can set `process.env` before first read. */
export const usageAggregatorServiceConfig: UsageAggregatorServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get tenantServiceUrl() {
    return (
      process.env.TENANT_SERVICE_URL ??
      "http://tenant-service.platform-dev.svc.cluster.local"
    );
  },
  get tenantDiscoveryIntervalMs() {
    return Number.parseInt(
      process.env.TENANT_DISCOVERY_INTERVAL_MS ?? "15000",
      10,
    );
  },
  get batchSize() {
    return Number.parseInt(process.env.USAGE_BATCH_SIZE ?? "500", 10);
  },
  get batchFlushMs() {
    return Number.parseInt(process.env.USAGE_BATCH_FLUSH_MS ?? "1000", 10);
  },
  get ingressDurableName() {
    return process.env.USAGE_INGRESS_DURABLE ?? "agg-INGRESS";
  },
  get dlqDurableName() {
    return process.env.USAGE_DLQ_DURABLE ?? "agg-DLQ";
  },
};
