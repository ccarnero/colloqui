import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  INTERVAL_MS: 2_000,
  NAMESPACE: "platform-services-dev",
  RING_BUFFER_CAPACITY: 10_000,
  SERVICES: [
    "event-processor",
    "webhook-service",
    "channel-service",
    "api-gateway",
    "cache-service",
    "metrics-service",
    "audit-service",
  ],
} as const;

interface CliOptions {
  intervalMs: number;
  namespace: string;
  outputPath: string;
}

interface HpaMetric {
  current: string;
  name: string;
  target: string;
}

interface SampleLine {
  hpaTargets: ReadonlyArray<HpaMetric>;
  pending: number;
  ready: number;
  replicas: number;
  service: string;
  ts: number;
}

interface PodCondition {
  status?: string;
  type?: string;
}

interface PodItem {
  metadata?: {
    labels?: Record<string, string>;
    name?: string;
  };
  status?: {
    conditions?: PodCondition[];
    phase?: string;
  };
}

interface HpaItem {
  metadata?: {
    name?: string;
  };
  spec?: {
    scaleTargetRef?: {
      name?: string;
    };
  };
  status?: {
    currentMetrics?: Array<{
      resource?: {
        current?: {
          averageUtilization?: number;
          averageValue?: string;
          value?: string;
        };
        name?: string;
        target?: {
          averageUtilization?: number;
          averageValue?: string;
          value?: string;
        };
      };
      type?: string;
    }>;
  };
}

class RingBuffer<T> {
  private readonly buffer: Array<T | undefined>;
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.buffer = Array.from({ length: capacity }, () => undefined);
  }

  push(value: T): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size += 1;
    }
  }

  count(): number {
    return this.size;
  }
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();

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

    options.set(key, value);
    index += 1;
  }

  const outputPath = options.get("output");
  if (!outputPath) {
    throw new Error("Missing required --output <path> argument.");
  }

  const intervalMs = Number(
    options.get("interval-ms") ?? process.env.STRESS_SAMPLER_INTERVAL_MS ?? DEFAULTS.INTERVAL_MS
  );
  const namespace =
    options.get("namespace") ??
    process.env.STRESS_NAMESPACE ??
    process.env.SMOKE_TEST_NAMESPACE ??
    DEFAULTS.NAMESPACE;

  return {
    intervalMs: Number.isFinite(intervalMs) ? intervalMs : DEFAULTS.INTERVAL_MS,
    namespace,
    outputPath,
  };
}

function parseWatchedServices(): ReadonlyArray<string> {
  const raw = process.env.STRESS_WATCH_SERVICES;
  if (!raw) {
    return DEFAULTS.SERVICES;
  }

  const parsed = raw
    .split(",")
    .map((service) => service.trim())
    .filter((service) => service.length > 0);

  if (parsed.length === 0) {
    return DEFAULTS.SERVICES;
  }

  return Object.freeze(parsed);
}

async function runKubectlJson(namespace: string, args: ReadonlyArray<string>): Promise<unknown> {
  const commandArgs = ["-n", namespace, ...args];
  const { stdout, stderr } = await execFileAsync("kubectl", commandArgs, {
    maxBuffer: 20 * 1024 * 1024,
  });

  if (stderr.trim().length > 0) {
    process.stderr.write(stderr);
  }

  return JSON.parse(stdout) as unknown;
}

function isPodReady(pod: PodItem): boolean {
  const conditions = pod.status?.conditions;
  if (!conditions) {
    return false;
  }

  for (const condition of conditions) {
    if (condition.type === "Ready") {
      return condition.status === "True";
    }
  }

  return false;
}

function collectPodStats(
  watchedServices: ReadonlyArray<string>,
  pods: ReadonlyArray<PodItem>
): Map<string, { pending: number; ready: number; replicas: number }> {
  const statsByService = new Map<
    string,
    {
      pending: number;
      ready: number;
      replicas: number;
    }
  >();

  for (const service of watchedServices) {
    statsByService.set(service, { pending: 0, ready: 0, replicas: 0 });
  }

  for (const pod of pods) {
    const service = pod.metadata?.labels?.["serving.knative.dev/service"];
    if (!service) {
      continue;
    }

    const stats = statsByService.get(service);
    if (!stats) {
      continue;
    }

    stats.replicas += 1;
    if (isPodReady(pod)) {
      stats.ready += 1;
    }
    if (pod.status?.phase !== "Running") {
      stats.pending += 1;
    }
  }

  return statsByService;
}

function toMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return `${value}`;
  }
  if (typeof value === "string") {
    return value;
  }
  return "n/a";
}

function collectHpaMetrics(
  watchedServices: ReadonlyArray<string>,
  hpas: ReadonlyArray<HpaItem>
): Map<string, ReadonlyArray<HpaMetric>> {
  const result = new Map<string, ReadonlyArray<HpaMetric>>();
  const watched = new Set(watchedServices);

  for (const hpa of hpas) {
    const service = hpa.spec?.scaleTargetRef?.name;
    if (!service || !watched.has(service)) {
      continue;
    }

    const metrics = hpa.status?.currentMetrics ?? [];
    const mapped: HpaMetric[] = [];
    for (const metric of metrics) {
      const resource = metric.resource;
      if (!resource) {
        continue;
      }

      mapped.push({
        current: toMetricValue(
          resource.current?.averageUtilization ??
            resource.current?.averageValue ??
            resource.current?.value
        ),
        name: resource.name ?? "unknown",
        target: toMetricValue(
          resource.target?.averageUtilization ??
            resource.target?.averageValue ??
            resource.target?.value
        ),
      });
    }

    result.set(service, mapped);
  }

  return result;
}

async function sampleClusterState(
  namespace: string,
  watchedServices: ReadonlyArray<string>
): Promise<ReadonlyArray<SampleLine>> {
  const [podsRaw, hpaRaw] = await Promise.all([
    runKubectlJson(namespace, ["get", "pods", "-o", "json"]),
    runKubectlJson(namespace, ["get", "hpa", "-o", "json"]),
  ]);

  const podItems = (podsRaw as { items?: PodItem[] }).items ?? [];
  const hpaItems = (hpaRaw as { items?: HpaItem[] }).items ?? [];

  const podStatsByService = collectPodStats(watchedServices, podItems);
  const hpaByService = collectHpaMetrics(watchedServices, hpaItems);

  const timestamp = Date.now();
  return watchedServices.map((service) => {
    const podStats = podStatsByService.get(service) ?? {
      pending: 0,
      ready: 0,
      replicas: 0,
    };

    return {
      hpaTargets: hpaByService.get(service) ?? [],
      pending: podStats.pending,
      ready: podStats.ready,
      replicas: podStats.replicas,
      service,
      ts: timestamp,
    };
  });
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const watchedServices = parseWatchedServices();

  const writeStream = createWriteStream(options.outputPath, { flags: "w" });
  const ringBuffer = new RingBuffer<SampleLine>(DEFAULTS.RING_BUFFER_CAPACITY);

  let keepRunning = true;
  let sampleCount = 0;

  const stop = (): void => {
    keepRunning = false;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  process.stdout.write(
    `[sampler] namespace=${options.namespace} intervalMs=${options.intervalMs} services=${watchedServices.join(",")}\n`
  );

  while (keepRunning) {
    try {
      const lines = await sampleClusterState(options.namespace, watchedServices);
      for (const line of lines) {
        writeStream.write(`${JSON.stringify(line)}\n`);
        ringBuffer.push(line);
        sampleCount += 1;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown sampler failure.";
      process.stderr.write(`[sampler] ${message}\n`);
    }

    await sleep(options.intervalMs);
  }

  writeStream.end();

  process.stdout.write(
    `[sampler] finished samples=${sampleCount} buffered=${ringBuffer.count()} output=${options.outputPath}\n`
  );
}

await main();
