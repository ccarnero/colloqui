/**
 * reconcile.ts — Phase 1 e2e reconciliation.
 *
 * Joins:
 *   1. The sink JSONL (one delivery per line, written by sink/server.ts).
 *   2. (Optional) The k6 streaming NDJSON (`--out json=...`) for per-stage
 *      sent counts. If not provided, expected counts are derived from the
 *      stage plan (rate × duration).
 *
 * Output:
 *   - Per-stage Markdown table (sent / delivered / lost / duplicates / p50/p95/p99).
 *   - CSV with the same columns for spreadsheet ingestion.
 *
 * Complexity:
 *   - One pass per file, O(n) over events.
 *   - Per-stage state in `Map<stage, StageBucket>`.
 *   - Per-correlation dedupe via `Set<string>` (size = unique deliveries).
 *   - Latency percentiles via `LatencyHistogram` (O(1) record, O(buckets) p99).
 */

import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

import { LatencyHistogram } from "../lib/histogram.ts";

interface DeliveryRecord {
  readonly correlation_id?: string;
  readonly delivered_at?: number;
  readonly latency_ms?: number;
  readonly sent_at?: number;
  readonly stage?: string;
}

interface K6PointTags {
  readonly stage?: string;
  readonly scenario?: string;
}

interface K6Point {
  readonly type?: string;
  readonly metric?: string;
  readonly data?: {
    readonly time?: string;
    readonly value?: number;
    readonly tags?: K6PointTags;
  };
}

interface StageBucket {
  readonly histogram: LatencyHistogram;
  delivered: number;
  duplicates: number;
  sentFromK6: number;
}

interface CliOptions {
  readonly k6JsonPath: string | null;
  readonly outputDir: string;
  readonly sinkJsonlPath: string;
  readonly stagesJsonPath: string | null;
  readonly scenario: string;
}

const STAGE_ORDER = ["baseline", "light", "medium", "heavy", "peak", "spike"];
const SENT_METRIC_NAMES = new Set([
  "phase1_events_sent",
  "phase1_webhook_sent",
]);

function parseCli(): CliOptions {
  const args = process.argv.slice(2);
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token || !token.startsWith("--")) {
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      continue;
    }
    opts.set(token.slice(2), next);
    i += 1;
  }

  const sinkJsonl = opts.get("sink");
  if (!sinkJsonl) {
    throw new Error("Missing required --sink <path>.");
  }

  return Object.freeze({
    k6JsonPath: opts.get("k6") ?? null,
    outputDir: resolve(opts.get("output") ?? "reports"),
    scenario: opts.get("scenario") ?? "events-callback",
    sinkJsonlPath: resolve(sinkJsonl),
    stagesJsonPath: opts.get("stages") ?? null,
  });
}

function ensureBucket(
  buckets: Map<string, StageBucket>,
  stage: string
): StageBucket {
  const existing = buckets.get(stage);
  if (existing) {
    return existing;
  }
  const created: StageBucket = {
    delivered: 0,
    duplicates: 0,
    histogram: new LatencyHistogram(),
    sentFromK6: 0,
  };
  buckets.set(stage, created);
  return created;
}

async function ingestSink(
  path: string,
  buckets: Map<string, StageBucket>
): Promise<void> {
  const seen = new Set<string>();
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) {
      continue;
    }
    let parsed: DeliveryRecord;
    try {
      parsed = JSON.parse(line) as DeliveryRecord;
    } catch {
      continue;
    }
    const correlationId = parsed.correlation_id;
    const stage = parsed.stage ?? "unknown";
    const latency = parsed.latency_ms;
    if (!correlationId || typeof latency !== "number") {
      continue;
    }

    const bucket = ensureBucket(buckets, stage);
    if (seen.has(correlationId)) {
      bucket.duplicates += 1;
      continue;
    }
    seen.add(correlationId);
    bucket.delivered += 1;
    bucket.histogram.record(latency);
  }
}

async function ingestK6Stream(
  path: string,
  buckets: Map<string, StageBucket>
): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) {
      continue;
    }
    let parsed: K6Point;
    try {
      parsed = JSON.parse(line) as K6Point;
    } catch {
      continue;
    }
    if (parsed.type !== "Point") {
      continue;
    }
    const metric = parsed.metric ?? "";
    if (!SENT_METRIC_NAMES.has(metric)) {
      continue;
    }
    const stage = parsed.data?.tags?.stage ?? "unknown";
    const value = parsed.data?.value ?? 0;
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    const bucket = ensureBucket(buckets, stage);
    bucket.sentFromK6 += value;
  }
}

interface StageRow {
  readonly delivered: number;
  readonly duplicates: number;
  readonly lost: number;
  readonly lossRate: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly sent: number;
  readonly stage: string;
}

function buildRow(stage: string, bucket: StageBucket): StageRow {
  const snap = bucket.histogram.snapshot();
  const sent = bucket.sentFromK6 > 0 ? bucket.sentFromK6 : bucket.delivered;
  const lost = Math.max(0, sent - bucket.delivered);
  const lossRate = sent > 0 ? lost / sent : 0;
  return {
    delivered: bucket.delivered,
    duplicates: bucket.duplicates,
    lossRate,
    lost,
    maxMs: snap.maxMs,
    meanMs: snap.meanMs,
    minMs: snap.minMs,
    p50Ms: snap.p50Ms,
    p95Ms: snap.p95Ms,
    p99Ms: snap.p99Ms,
    sent,
    stage,
  };
}

function sortStages(stages: ReadonlyArray<string>): ReadonlyArray<string> {
  const indexMap = new Map<string, number>();
  for (let i = 0; i < STAGE_ORDER.length; i += 1) {
    const name = STAGE_ORDER[i];
    if (name) {
      indexMap.set(name, i);
    }
  }
  return [...stages].sort((a, b) => {
    const ai = indexMap.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bi = indexMap.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) {
      return ai - bi;
    }
    return a.localeCompare(b);
  });
}

function fmtMs(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "-";
  }
  return value < 10 ? value.toFixed(2) : value.toFixed(0);
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function buildMarkdown(
  scenario: string,
  rows: ReadonlyArray<StageRow>
): string {
  const lines: string[] = [];
  lines.push(`# Reconciliation — \`${scenario}\``);
  lines.push("");
  if (rows.length === 0) {
    lines.push(
      "_No stages observed. The sink JSONL is empty AND the k6 NDJSON did not"
    );
    lines.push(
      "report any `phase1_*_sent` counter. Pass both `--sink` and `--k6`, or"
    );
    lines.push(
      "check that the scenario actually exercises a counter named like"
    );
    lines.push("`phase1_<scenario>_sent`._");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  const sinkActive = rows.some((row) => row.delivered > 0);
  if (!sinkActive) {
    lines.push("> **Note:** the sink observed 0 deliveries during this run.");
    lines.push(
      "> The `Sent` column comes from k6 counters; latency / loss columns"
    );
    lines.push("> are derived from no e2e samples and must be read as `n/a`.");
    lines.push("> See README → 'Reading the results' for the current e2e gap.");
    lines.push("");
  }
  lines.push(
    "| Stage | Sent | Delivered | Lost | Loss % | Duplicates | p50 ms | p95 ms | p99 ms | min ms | max ms |"
  );
  lines.push(
    "|-------|------|-----------|------|--------|------------|--------|--------|--------|--------|--------|"
  );
  for (const row of rows) {
    lines.push(
      `| ${row.stage} | ${row.sent} | ${row.delivered} | ${row.lost} | ${fmtPct(row.lossRate)} | ${row.duplicates} | ${fmtMs(row.p50Ms)} | ${fmtMs(row.p95Ms)} | ${fmtMs(row.p99Ms)} | ${fmtMs(row.minMs)} | ${fmtMs(row.maxMs)} |`
    );
  }
  lines.push("");
  lines.push("## Stop-rule audit");
  lines.push("");
  for (const row of rows) {
    const violations: string[] = [];
    if (sinkActive && row.lossRate > 0) {
      violations.push("loss > 0");
    }
    if (row.duplicates > 0) {
      violations.push("duplicates > 0");
    }
    const verdict =
      violations.length === 0
        ? sinkActive
          ? "OK"
          : "n/a (no sink data)"
        : violations.join(", ");
    lines.push(`- **${row.stage}**: ${verdict}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildCsv(rows: ReadonlyArray<StageRow>): string {
  const header =
    "stage,sent,delivered,lost,loss_rate,duplicates,p50_ms,p95_ms,p99_ms,min_ms,max_ms,mean_ms";
  const lines = [header];
  for (const row of rows) {
    lines.push(
      [
        row.stage,
        row.sent,
        row.delivered,
        row.lost,
        row.lossRate.toFixed(6),
        row.duplicates,
        row.p50Ms.toFixed(2),
        row.p95Ms.toFixed(2),
        row.p99Ms.toFixed(2),
        row.minMs.toFixed(2),
        row.maxMs.toFixed(2),
        row.meanMs.toFixed(2),
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

async function writeReport(
  outputDir: string,
  scenario: string,
  markdown: string,
  csv: string
): Promise<{ markdown: string; csv: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const mdPath = resolve(outputDir, `${scenario}-${stamp}.reconcile.md`);
  const csvPath = resolve(outputDir, `${scenario}-${stamp}.reconcile.csv`);
  await mkdir(dirname(mdPath), { recursive: true });
  await Promise.all([
    writeFile(mdPath, markdown, "utf8"),
    writeFile(csvPath, csv, "utf8"),
  ]);
  return { csv: csvPath, markdown: mdPath };
}

async function main(): Promise<void> {
  const opts = parseCli();
  const buckets = new Map<string, StageBucket>();

  await ingestSink(opts.sinkJsonlPath, buckets);
  if (opts.k6JsonPath) {
    await ingestK6Stream(opts.k6JsonPath, buckets);
  }

  const ordered = sortStages([...buckets.keys()]);
  const rows: StageRow[] = ordered.map((stage) => {
    const bucket = buckets.get(stage);
    if (!bucket) {
      return buildRow(stage, {
        delivered: 0,
        duplicates: 0,
        histogram: new LatencyHistogram(),
        sentFromK6: 0,
      });
    }
    return buildRow(stage, bucket);
  });

  const markdown = buildMarkdown(opts.scenario, rows);
  const csv = buildCsv(rows);
  const { markdown: mdPath, csv: csvPath } = await writeReport(
    opts.outputDir,
    opts.scenario,
    markdown,
    csv
  );

  process.stdout.write(`reconcile.markdown=${mdPath}\n`);
  process.stdout.write(`reconcile.csv=${csvPath}\n`);
}

await main();
