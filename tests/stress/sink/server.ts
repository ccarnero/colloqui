/**
 * stress-sink — Bun HTTP server for Phase 1 e2e capture.
 *
 *   POST /sink              -> records correlation_id + sent_at + delivered_at
 *   GET  /healthz           -> liveness probe
 *   GET  /readyz            -> readiness probe
 *   GET  /metrics           -> Prometheus exposition (per-stage counters + p95/p99)
 *   GET  /stats             -> JSON snapshot for the reconciler
 *
 * Performance characteristics:
 *   - Bun.serve handles HTTP in native code; per-request work is O(1).
 *   - In-memory aggregation uses `Map<string, StageStats>` keyed by stage.
 *   - JSONL writes are buffered and flushed every 1 s OR every 64 KiB to keep
 *     the disk writer off the hot path.
 *   - Latency uses a bucketed histogram (lib/histogram.ts) — O(1) record,
 *     O(buckets) percentile.
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { LatencyHistogram } from "../lib/histogram.ts";

interface SinkPayload {
  readonly correlation_id?: string;
  readonly sent_at?: number;
  readonly stage?: string;
}

interface DeliveryRecord {
  readonly correlation_id: string;
  readonly delivered_at: number;
  readonly latency_ms: number;
  readonly sent_at: number;
  readonly stage: string;
}

interface StageStats {
  readonly histogram: LatencyHistogram;
  count: number;
  duplicates: number;
}

interface SinkConfig {
  readonly bufferBytes: number;
  readonly flushMs: number;
  readonly mirrorStdout: boolean;
  readonly outputPath: string;
  readonly port: number;
}

function readEnv(): Record<string, string | undefined> {
  return process.env;
}

function envNumber(key: string, fallback: number): number {
  const env = readEnv();
  const raw = env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envString(key: string, fallback: string): string {
  return readEnv()[key] ?? fallback;
}

function loadConfig(): SinkConfig {
  return Object.freeze({
    bufferBytes: envNumber("STRESS_SINK_BUFFER_BYTES", 65_536),
    flushMs: envNumber("STRESS_SINK_FLUSH_MS", 1_000),
    mirrorStdout: envString("STRESS_SINK_STDOUT", "false") === "true",
    outputPath: resolve(envString("STRESS_SINK_OUTPUT", "reports/sink.jsonl")),
    port: envNumber("STRESS_SINK_PORT", 8080),
  });
}

class JsonlWriter {
  private readonly chunks: string[] = [];
  private bytesPending = 0;
  private readonly stream: ReturnType<typeof createWriteStream>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    path: string,
    private readonly bufferBytes: number,
    private readonly flushMs: number,
    private readonly mirrorStdout: boolean
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: "a" });
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushMs);
  }

  write(record: DeliveryRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    this.chunks.push(line);
    this.bytesPending += line.length;
    if (this.mirrorStdout) {
      process.stdout.write(line);
    }
    if (this.bytesPending >= this.bufferBytes) {
      this.flush();
    }
  }

  flush(): void {
    if (this.chunks.length === 0) {
      return;
    }
    const payload = this.chunks.join("");
    this.chunks.length = 0;
    this.bytesPending = 0;
    this.stream.write(payload);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
    await new Promise<void>((resolveStop) => {
      this.stream.end(resolveStop);
    });
  }
}

class StageRegistry {
  private readonly byStage = new Map<string, StageStats>();
  private readonly seen = new Map<string, number>();
  private readonly seenCapacity = envNumber(
    "STRESS_SINK_SEEN_CAPACITY",
    5_000_000
  );
  private seenInsertionOrder: string[] = [];

  observe(record: DeliveryRecord): { duplicate: boolean } {
    const existing = this.seen.get(record.correlation_id);
    if (existing !== undefined) {
      const stats = this.ensureStage(record.stage);
      stats.duplicates += 1;
      return { duplicate: true };
    }

    this.seen.set(record.correlation_id, record.delivered_at);
    this.seenInsertionOrder.push(record.correlation_id);
    if (this.seenInsertionOrder.length > this.seenCapacity) {
      const dropped = this.seenInsertionOrder.shift();
      if (dropped !== undefined) {
        this.seen.delete(dropped);
      }
    }

    const stats = this.ensureStage(record.stage);
    stats.count += 1;
    stats.histogram.record(record.latency_ms);
    return { duplicate: false };
  }

  snapshot(): Array<{
    stage: string;
    count: number;
    duplicates: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    minMs: number;
    maxMs: number;
    meanMs: number;
  }> {
    const result: Array<{
      stage: string;
      count: number;
      duplicates: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      minMs: number;
      maxMs: number;
      meanMs: number;
    }> = [];
    for (const [stage, stats] of this.byStage) {
      const snap = stats.histogram.snapshot();
      result.push({
        count: stats.count,
        duplicates: stats.duplicates,
        maxMs: snap.maxMs,
        meanMs: snap.meanMs,
        minMs: snap.minMs,
        p50Ms: snap.p50Ms,
        p95Ms: snap.p95Ms,
        p99Ms: snap.p99Ms,
        stage,
      });
    }
    return result;
  }

  private ensureStage(stage: string): StageStats {
    const existing = this.byStage.get(stage);
    if (existing) {
      return existing;
    }
    const created: StageStats = {
      count: 0,
      duplicates: 0,
      histogram: new LatencyHistogram(),
    };
    this.byStage.set(stage, created);
    return created;
  }
}

function isSinkPayload(input: unknown): input is SinkPayload {
  return typeof input === "object" && input !== null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildPrometheusExposition(registry: StageRegistry): string {
  const lines: string[] = [];
  lines.push(
    "# HELP stress_sink_delivered_total Deliveries observed by the sink."
  );
  lines.push("# TYPE stress_sink_delivered_total counter");
  for (const row of registry.snapshot()) {
    lines.push(
      `stress_sink_delivered_total{stage="${row.stage}"} ${row.count}`
    );
  }
  lines.push(
    "# HELP stress_sink_duplicates_total Duplicate deliveries observed."
  );
  lines.push("# TYPE stress_sink_duplicates_total counter");
  for (const row of registry.snapshot()) {
    lines.push(
      `stress_sink_duplicates_total{stage="${row.stage}"} ${row.duplicates}`
    );
  }
  lines.push("# HELP stress_sink_latency_ms Stage e2e latency snapshot.");
  lines.push("# TYPE stress_sink_latency_ms gauge");
  for (const row of registry.snapshot()) {
    const stage = row.stage;
    lines.push(
      `stress_sink_latency_ms{stage="${stage}",quantile="0.5"} ${row.p50Ms.toFixed(2)}`
    );
    lines.push(
      `stress_sink_latency_ms{stage="${stage}",quantile="0.95"} ${row.p95Ms.toFixed(2)}`
    );
    lines.push(
      `stress_sink_latency_ms{stage="${stage}",quantile="0.99"} ${row.p99Ms.toFixed(2)}`
    );
  }
  return `${lines.join("\n")}\n`;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const text = await request.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function handleSink(
  request: Request,
  writer: JsonlWriter,
  registry: StageRegistry
): Promise<Response> {
  const payload = await readJsonBody(request);
  if (!isSinkPayload(payload)) {
    return new Response("invalid body", { status: 400 });
  }

  const correlationId = asString(
    payload.correlation_id,
    request.headers.get("x-correlation-id") ?? ""
  );
  if (!correlationId) {
    return new Response("missing correlation_id", { status: 400 });
  }

  const sentAt = asFiniteNumber(payload.sent_at);
  const deliveredAt = Date.now();
  const stage = asString(payload.stage, "unknown");

  if (sentAt === null) {
    return new Response("missing sent_at", { status: 400 });
  }

  const record: DeliveryRecord = {
    correlation_id: correlationId,
    delivered_at: deliveredAt,
    latency_ms: deliveredAt - sentAt,
    sent_at: sentAt,
    stage,
  };

  registry.observe(record);
  writer.write(record);
  return new Response("ok", { status: 202 });
}

function handleHealth(): Response {
  return new Response("ok", { status: 200 });
}

function handleStats(registry: StageRegistry): Response {
  return new Response(JSON.stringify({ stages: registry.snapshot() }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function handleMetrics(registry: StageRegistry): Response {
  return new Response(buildPrometheusExposition(registry), {
    headers: { "content-type": "text/plain; version=0.0.4" },
    status: 200,
  });
}

async function dispatch(
  request: Request,
  writer: JsonlWriter,
  registry: StageRegistry
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/sink") {
    return handleSink(request, writer, registry);
  }
  if (request.method === "GET" && url.pathname === "/healthz") {
    return handleHealth();
  }
  if (request.method === "GET" && url.pathname === "/readyz") {
    return handleHealth();
  }
  if (request.method === "GET" && url.pathname === "/metrics") {
    return handleMetrics(registry);
  }
  if (request.method === "GET" && url.pathname === "/stats") {
    return handleStats(registry);
  }
  return new Response("not found", { status: 404 });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const writer = new JsonlWriter(
    config.outputPath,
    config.bufferBytes,
    config.flushMs,
    config.mirrorStdout
  );
  writer.start();
  const registry = new StageRegistry();

  const stop = async (): Promise<void> => {
    await writer.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void stop();
  });
  process.on("SIGINT", () => {
    void stop();
  });

  const server = Bun.serve({
    port: config.port,
    fetch: (request) => dispatch(request, writer, registry),
  });

  process.stdout.write(
    `[stress-sink] listening on :${server.port} -> ${config.outputPath}\n`
  );
}

await main();
