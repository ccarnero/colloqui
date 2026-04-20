import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";

interface CliOptions {
  artilleryPath: string;
  outputPath: string;
  samplerPath: string;
  scenarioName: string;
}

interface SamplerLine {
  pending: number;
  ready: number;
  replicas: number;
  service: string;
  ts: number;
}

interface ServiceThreshold {
  minPeakReplicas: number;
  scaleUpSlaSeconds: number;
}

interface Thresholds {
  global: {
    maxErrorRate: number;
    maxP99Ms: number;
  };
  services: Record<string, ServiceThreshold>;
}

interface ArtillerySummary {
  errorRate: number;
  p95Ms: number;
  p99Ms: number;
  responses: number;
  successful2xx: number;
}

interface ServiceStats {
  avgReplicas: number;
  maxReplicas: number;
  minReplicas: number;
  samples: number;
  scaleUpLatencySeconds: number | null;
  settleTimeSeconds: number | null;
  timeline: string;
}

function parseArgs(): Partial<CliOptions> {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }

    map.set(key, value);
    index += 1;
  }

  return {
    artilleryPath: map.get("artillery"),
    outputPath: map.get("output"),
    samplerPath: map.get("sampler"),
    scenarioName: map.get("scenario"),
  };
}

function getByPath(source: unknown, path: ReadonlyArray<string>): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function parseArtillerySummary(payload: unknown): ArtillerySummary {
  const counters = (getByPath(payload, ["aggregate", "counters"]) ??
    {}) as Record<string, unknown>;
  const summaries = (getByPath(payload, ["aggregate", "summaries"]) ??
    {}) as Record<string, unknown>;
  const responseSummary = (summaries["http.response_time"] ??
    {}) as Record<string, unknown>;

  let responses = 0;
  let successful2xx = 0;

  for (const [key, value] of Object.entries(counters)) {
    if (!key.startsWith("http.codes.")) {
      continue;
    }
    const count = toNumber(value);
    responses += count;
    const statusCode = Number(key.slice("http.codes.".length));
    if (statusCode >= 200 && statusCode < 300) {
      successful2xx += count;
    }
  }

  if (responses === 0) {
    responses = toNumber(counters["http.responses"]);
  }

  const failed = Math.max(responses - successful2xx, 0);
  const errorRate = responses > 0 ? failed / responses : 0;

  return {
    errorRate,
    p95Ms: toNumber(responseSummary["p95"]),
    p99Ms: toNumber(responseSummary["p99"]),
    responses,
    successful2xx,
  };
}

function parseSamplerLines(content: string): ReadonlyArray<SamplerLine> {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: SamplerLine[] = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line) as Partial<SamplerLine>;
      if (
        typeof item.service === "string" &&
        typeof item.ts === "number" &&
        typeof item.replicas === "number" &&
        typeof item.ready === "number" &&
        typeof item.pending === "number"
      ) {
        parsed.push(item as SamplerLine);
      }
    } catch {
      continue;
    }
  }

  return parsed.sort((left, right) => left.ts - right.ts);
}

function createTimeline(samples: ReadonlyArray<SamplerLine>, bucketCount = 20): string {
  if (samples.length === 0) {
    return "n/a";
  }

  if (samples.length <= bucketCount) {
    return samples.map((sample) => `${sample.replicas}`).join(" ");
  }

  const bucketSize = Math.ceil(samples.length / bucketCount);
  const buckets: string[] = [];

  for (let index = 0; index < samples.length; index += bucketSize) {
    const chunk = samples.slice(index, index + bucketSize);
    const avg =
      chunk.reduce((sum, sample) => sum + sample.replicas, 0) / chunk.length;
    buckets.push(`${Math.round(avg)}`);
  }

  return buckets.join(" ");
}

function computeServiceStats(samples: ReadonlyArray<SamplerLine>): ServiceStats {
  if (samples.length === 0) {
    return {
      avgReplicas: 0,
      maxReplicas: 0,
      minReplicas: 0,
      samples: 0,
      scaleUpLatencySeconds: null,
      settleTimeSeconds: null,
      timeline: "n/a",
    };
  }

  const replicaValues = samples.map((sample) => sample.replicas);
  const minReplicas = Math.min(...replicaValues);
  const maxReplicas = Math.max(...replicaValues);
  const avgReplicas =
    replicaValues.reduce((sum, replicas) => sum + replicas, 0) / samples.length;

  const firstTs = samples[0].ts;
  const firstScaleSample = samples.find((sample) => sample.replicas > minReplicas);
  const scaleUpLatencySeconds = firstScaleSample
    ? (firstScaleSample.ts - firstTs) / 1000
    : null;

  let peakTimestamp = firstTs;
  for (const sample of samples) {
    if (sample.replicas === maxReplicas) {
      peakTimestamp = sample.ts;
      break;
    }
  }

  const settledSample = samples.find(
    (sample) => sample.ts >= peakTimestamp && sample.replicas <= minReplicas
  );
  const settleTimeSeconds = settledSample
    ? (settledSample.ts - peakTimestamp) / 1000
    : null;

  return {
    avgReplicas,
    maxReplicas,
    minReplicas,
    samples: samples.length,
    scaleUpLatencySeconds,
    settleTimeSeconds,
    timeline: createTimeline(samples),
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function serviceVerdict(
  service: string,
  stats: ServiceStats,
  thresholds: Thresholds
): string {
  const target = thresholds.services[service];
  if (!target) {
    return "N/A (no threshold)";
  }

  const maxOk = stats.maxReplicas >= target.minPeakReplicas;
  const latencyOk =
    stats.scaleUpLatencySeconds !== null &&
    stats.scaleUpLatencySeconds <= target.scaleUpSlaSeconds;

  return maxOk && latencyOk ? "PASS" : "FAIL";
}

function globalVerdict(summary: ArtillerySummary, thresholds: Thresholds): string {
  const errorOk = summary.errorRate <= thresholds.global.maxErrorRate;
  const p99Ok = summary.p99Ms <= thresholds.global.maxP99Ms;
  return errorOk && p99Ok ? "PASS" : "FAIL";
}

async function findLatestReportArtifact(
  reportsDir: string,
  extension: ".json" | ".jsonl"
): Promise<string | null> {
  try {
    const entries = await fs.readdir(reportsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) =>
        extension === ".json"
          ? name.endsWith(".json") && !name.endsWith(".jsonl")
          : name.endsWith(".jsonl")
      );

    if (files.length === 0) {
      return null;
    }

    let latestPath = join(reportsDir, files[0]);
    let latestMtime = (await fs.stat(latestPath)).mtimeMs;

    for (const file of files.slice(1)) {
      const fullPath = join(reportsDir, file);
      const mtime = (await fs.stat(fullPath)).mtimeMs;
      if (mtime > latestMtime) {
        latestMtime = mtime;
        latestPath = fullPath;
      }
    }

    return latestPath;
  } catch {
    return null;
  }
}

async function resolveOptions(): Promise<CliOptions> {
  const provided = parseArgs();
  const reportsDir = join(process.cwd(), "reports");

  const artilleryPath =
    provided.artilleryPath ??
    process.env.STRESS_ARTILLERY_REPORT ??
    (await findLatestReportArtifact(reportsDir, ".json"));
  const samplerPath =
    provided.samplerPath ??
    process.env.STRESS_SAMPLER_REPORT ??
    (await findLatestReportArtifact(reportsDir, ".jsonl"));

  if (!artilleryPath || !samplerPath) {
    throw new Error(
      "Missing report inputs. Provide --artillery and --sampler or set STRESS_ARTILLERY_REPORT and STRESS_SAMPLER_REPORT."
    );
  }

  const scenarioName =
    provided.scenarioName ??
    basename(artilleryPath).replace(/\.json$/u, "").replace(/-\d{8}-\d{6}$/u, "");
  const outputPath =
    provided.outputPath ??
    join(dirname(artilleryPath), `${scenarioName}.scaling.md`);

  return {
    artilleryPath,
    outputPath,
    samplerPath,
    scenarioName,
  };
}

async function loadThresholds(): Promise<Thresholds> {
  const thresholdsPath = join(process.cwd(), "scale", "thresholds.json");
  const raw = await fs.readFile(thresholdsPath, "utf-8");
  return JSON.parse(raw) as Thresholds;
}

function renderMarkdown(
  options: CliOptions,
  summary: ArtillerySummary,
  serviceStatsByName: Map<string, ServiceStats>,
  thresholds: Thresholds
): string {
  const globalPass = globalVerdict(summary, thresholds);
  const lines: string[] = [];

  lines.push(`# Scaling report: ${options.scenarioName}`);
  lines.push("");
  lines.push("## Global results");
  lines.push("");
  lines.push(`- Verdict: **${globalPass}**`);
  lines.push(`- Responses: ${formatNumber(summary.responses)}`);
  lines.push(`- Successful 2xx: ${formatNumber(summary.successful2xx)}`);
  lines.push(`- Error rate: ${(summary.errorRate * 100).toFixed(2)}%`);
  lines.push(`- HTTP p95: ${formatNumber(summary.p95Ms)} ms`);
  lines.push(`- HTTP p99: ${formatNumber(summary.p99Ms)} ms`);
  lines.push(
    `- Thresholds: error <= ${(thresholds.global.maxErrorRate * 100).toFixed(2)}%, p99 <= ${formatNumber(thresholds.global.maxP99Ms)} ms`
  );
  lines.push("");
  lines.push("## Service scaling");
  lines.push("");

  const sortedServices = Array.from(serviceStatsByName.keys()).sort();
  for (const service of sortedServices) {
    const stats = serviceStatsByName.get(service);
    if (!stats) {
      continue;
    }

    const verdict = serviceVerdict(service, stats, thresholds);
    const threshold = thresholds.services[service];
    const thresholdLine = threshold
      ? `peak >= ${threshold.minPeakReplicas}, scale-up <= ${threshold.scaleUpSlaSeconds}s`
      : "no service threshold configured";

    lines.push(`### ${service}`);
    lines.push("");
    lines.push(`- Verdict: **${verdict}** (${thresholdLine})`);
    lines.push(`- Samples: ${stats.samples}`);
    lines.push(`- Replicas min/max/avg: ${formatNumber(stats.minReplicas)} / ${formatNumber(stats.maxReplicas)} / ${formatNumber(stats.avgReplicas)}`);
    lines.push(
      `- Scale-up latency: ${stats.scaleUpLatencySeconds === null ? "n/a" : `${formatNumber(stats.scaleUpLatencySeconds)} s`}`
    );
    lines.push(
      `- Settle time: ${stats.settleTimeSeconds === null ? "n/a" : `${formatNumber(stats.settleTimeSeconds)} s`}`
    );
    lines.push(`- Timeline (bucketed replicas): \`${stats.timeline}\``);
    lines.push("");
  }

  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- Artillery: \`${options.artilleryPath}\``);
  lines.push(`- Sampler: \`${options.samplerPath}\``);
  lines.push(`- Report: \`${options.outputPath}\``);
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = await resolveOptions();
  const thresholds = await loadThresholds();

  const [artilleryRaw, samplerRaw] = await Promise.all([
    fs.readFile(options.artilleryPath, "utf-8"),
    fs.readFile(options.samplerPath, "utf-8"),
  ]);

  const artillery = JSON.parse(artilleryRaw) as unknown;
  const summary = parseArtillerySummary(artillery);
  const lines = parseSamplerLines(samplerRaw);

  const serviceSamples = new Map<string, SamplerLine[]>();
  for (const line of lines) {
    const existing = serviceSamples.get(line.service) ?? [];
    existing.push(line);
    serviceSamples.set(line.service, existing);
  }

  const serviceStatsByName = new Map<string, ServiceStats>();
  for (const [service, samples] of serviceSamples) {
    serviceStatsByName.set(service, computeServiceStats(samples));
  }

  const markdown = renderMarkdown(options, summary, serviceStatsByName, thresholds);
  await fs.writeFile(options.outputPath, markdown, "utf-8");

  process.stdout.write(`[report] wrote ${options.outputPath}\n`);
}

await main();
