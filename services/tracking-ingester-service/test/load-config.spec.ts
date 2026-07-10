import { describe, expect, it } from "bun:test";
import {
  loadTrackingIngesterConfig,
  POSTGRES_DSN_ENV,
} from "../src/lib/load-config.js";

const NATS = "nats://user:pass@nats.dev:4222";
const PG = "postgres://user:pass@pg.dev:5432/tracking";

describe("loadTrackingIngesterConfig — required-env validation", () => {
  it("errors naming NATS_URL when it is missing", () => {
    const result = loadTrackingIngesterConfig({ POSTGRES_URL: PG });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.missing).toContain("NATS_URL");
    expect(result.error.message).toContain("NATS_URL");
  });

  it("errors naming the Postgres DSN set when none is present", () => {
    const result = loadTrackingIngesterConfig({ NATS_URL: NATS });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    // The whole precedence set is surfaced so either var satisfies it.
    const missing = result.error.missing.join(" ");
    for (const name of POSTGRES_DSN_ENV) {
      expect(missing).toContain(name);
    }
  });

  it("reports BOTH missing names at once (fail-fast, not one-at-a-time)", () => {
    const result = loadTrackingIngesterConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.missing).toHaveLength(2);
    expect(result.error.missing[0]).toBe("NATS_URL");
  });

  it("treats a blank/whitespace value as missing (never a silent default)", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: "   ",
      POSTGRES_URL: PG,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.missing).toContain("NATS_URL");
  });

  it("accepts DATABASE_URL as the Postgres DSN fallback", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      DATABASE_URL: PG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.postgresUrl).toBe(PG);
  });

  it("prefers POSTGRES_URL over DATABASE_URL", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      DATABASE_URL: "postgres://other/db",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.postgresUrl).toBe(PG);
  });
});

describe("loadTrackingIngesterConfig — defaults and overrides", () => {
  it("applies non-secret defaults when only credentials are set", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    const cfg = result.value;
    expect(cfg.port).toBe(3000);
    expect(cfg.maxAckPending).toBe(1000);
    expect(cfg.batchSize).toBe(100);
    expect(cfg.batchFlushMs).toBe(1000);
    // Concurrency defaults to batchSize so a size-triggered flush is reachable.
    expect(cfg.concurrency).toBe(cfg.batchSize);
    // Unlimited redelivery — DLQ-disabled consumers must not drop rows.
    expect(cfg.maxDeliver).toBe(-1);
    // First backoff step must exceed the batch flush window.
    expect(cfg.backoffMs[0]!).toBeGreaterThan(cfg.batchFlushMs);
  });

  it("honors numeric overrides and derives concurrency from batchSize", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      PORT: "8080",
      TRK_MAX_ACK_PENDING: "500",
      TRK_BATCH_SIZE: "250",
      TRK_BATCH_FLUSH_MS: "2000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    const cfg = result.value;
    expect(cfg.port).toBe(8080);
    expect(cfg.maxAckPending).toBe(500);
    expect(cfg.batchSize).toBe(250);
    expect(cfg.batchFlushMs).toBe(2000);
    expect(cfg.concurrency).toBe(250);
  });

  it("lets TRK_CONCURRENCY override the batchSize-derived default", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      TRK_BATCH_SIZE: "100",
      TRK_CONCURRENCY: "16",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.concurrency).toBe(16);
  });

  it("falls back to the default when a numeric var is non-numeric", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      PORT: "not-a-number",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.port).toBe(3000);
  });

  it("defaults the backoff schedule to [30s, 60s, 120s, 300s]", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.backoffMs).toEqual([30000, 60000, 120000, 300000]);
  });

  it("parses TRK_BACKOFF_MS as a comma-separated ms list", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      TRK_BACKOFF_MS: "5000,10000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.backoffMs).toEqual([5000, 10000]);
  });

  it("falls back to the default backoff when TRK_BACKOFF_MS is malformed", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      TRK_BACKOFF_MS: "5000,notanumber,",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.backoffMs).toEqual([30000, 60000, 120000, 300000]);
  });

  it("rejects a TRK_BACKOFF_MS list with a non-positive element", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      TRK_BACKOFF_MS: "5000,0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.backoffMs).toEqual([30000, 60000, 120000, 300000]);
  });

  it("lets TRK_MAX_DELIVER override the unlimited default", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      TRK_MAX_DELIVER: "5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.maxDeliver).toBe(5);
  });

  it("clamps concurrency to maxAckPending and logs when it exceeds it", () => {
    const logs: string[] = [];
    const result = loadTrackingIngesterConfig(
      {
        NATS_URL: NATS,
        POSTGRES_URL: PG,
        TRK_MAX_ACK_PENDING: "10",
        TRK_CONCURRENCY: "50",
      },
      (m) => logs.push(m)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.concurrency).toBe(10);
    expect(logs.some((m) => m.includes("clamping"))).toBe(true);
  });

  it("falls back for a zero/negative TRK_BATCH_SIZE or TRK_CONCURRENCY", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      TRK_BATCH_SIZE: "0",
      TRK_CONCURRENCY: "-4",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    // Both fall back to their defaults (batchSize 100, concurrency = batchSize).
    expect(result.value.batchSize).toBe(100);
    expect(result.value.concurrency).toBe(100);
  });
});

describe("loadTrackingIngesterConfig — OTel export config (T2)", () => {
  it("defaults otelExportEnabled to false and endpoint to undefined", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.otelExportEnabled).toBe(false);
    expect(result.value.otelExporterOtlpEndpoint).toBeUndefined();
  });

  it("leaves the endpoint unset without error when export is disabled", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      OTEL_EXPORT_ENABLED: "false",
    });
    expect(result.ok).toBe(true);
  });

  it("errors when OTEL_EXPORT_ENABLED=true but the endpoint is unset", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      OTEL_EXPORT_ENABLED: "true",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected err");
    }
    expect(result.error.missing.join(" ")).toContain(
      "OTEL_EXPORTER_OTLP_ENDPOINT"
    );
  });

  it("accepts OTEL_EXPORT_ENABLED=true with an endpoint set", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      OTEL_EXPORT_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.dev:4318/v1/traces",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.otelExportEnabled).toBe(true);
    expect(result.value.otelExporterOtlpEndpoint).toBe(
      "http://otel-collector.dev:4318/v1/traces"
    );
  });

  it("accepts '1' as a truthy value for OTEL_EXPORT_ENABLED", () => {
    const result = loadTrackingIngesterConfig({
      NATS_URL: NATS,
      POSTGRES_URL: PG,
      OTEL_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.dev:4318/v1/traces",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.otelExportEnabled).toBe(true);
  });
});
