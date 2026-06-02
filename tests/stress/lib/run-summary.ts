export type RunSummary = {
  label: string;
  targetRate: number;
  duration: string;
  sent: number;
  actualRate: number;
  httpFailureRate: number;
  ackP95Ms: number;
  ackP99Ms: number;
  ackMaxMs: number;
  droppedIterations: number;
  delivered: number;
  lost: number;
  lossRate: number;
  duplicates: number;
  e2eP50Ms: number;
  e2eP95Ms: number;
  e2eP99Ms: number;
};

type Metric = Record<string, number | undefined>;

type K6Summary = {
  metrics?: Record<string, Metric | undefined>;
};

export function buildRunSummary(input: {
  label: string;
  targetRate: number;
  duration: string;
  k6Summary: K6Summary;
  reconcileCsv: string;
}): RunSummary {
  const metrics = input.k6Summary.metrics ?? {};
  const sent = requiredNumber(metrics.phase1_webhook_sent, "count");
  const ack = metrics.phase1_webhook_ack_ms;
  const reconcile = parseReconcileCsv(input.reconcileCsv);

  return {
    label: input.label,
    targetRate: input.targetRate,
    duration: input.duration,
    sent,
    actualRate: requiredNumber(metrics.phase1_webhook_sent, "rate"),
    httpFailureRate: requiredNumber(metrics.http_req_failed, "value"),
    ackP95Ms: requiredNumber(ack, "p(95)"),
    ackP99Ms: requiredNumber(ack, "p(99)"),
    ackMaxMs: requiredNumber(ack, "max"),
    droppedIterations: metrics.dropped_iterations?.count ?? 0,
    delivered: reconcile.delivered,
    lost: reconcile.lost,
    lossRate: reconcile.lossRate,
    duplicates: reconcile.duplicates,
    e2eP50Ms: reconcile.e2eP50Ms,
    e2eP95Ms: reconcile.e2eP95Ms,
    e2eP99Ms: reconcile.e2eP99Ms,
  };
}

export function formatRunSummaryCsvRow(summary: RunSummary): string {
  return [
    summary.label,
    summary.targetRate,
    summary.duration,
    summary.sent,
    summary.actualRate.toFixed(2),
    summary.httpFailureRate.toFixed(6),
    summary.ackP95Ms.toFixed(2),
    summary.ackP99Ms.toFixed(2),
    summary.ackMaxMs.toFixed(2),
    summary.droppedIterations,
    summary.delivered,
    summary.lost,
    summary.lossRate.toFixed(6),
    summary.duplicates,
    summary.e2eP50Ms.toFixed(2),
    summary.e2eP95Ms.toFixed(2),
    summary.e2eP99Ms.toFixed(2),
  ].join(",");
}

export const runSummaryCsvHeader = [
  "label",
  "target_rate",
  "duration",
  "sent",
  "actual_rate",
  "http_failure_rate",
  "ack_p95_ms",
  "ack_p99_ms",
  "ack_max_ms",
  "dropped_iterations",
  "delivered",
  "lost",
  "loss_rate",
  "duplicates",
  "e2e_p50_ms",
  "e2e_p95_ms",
  "e2e_p99_ms",
].join(",");

function parseReconcileCsv(csv: string) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0]?.split(",") ?? [];
  const values = lines[1]?.split(",") ?? [];
  const valueByHeader = new Map(headers.map((header, index) => [header, values[index]]));

  return {
    delivered: requiredCsvNumber(valueByHeader, "delivered"),
    lost: requiredCsvNumber(valueByHeader, "lost"),
    lossRate: requiredCsvNumber(valueByHeader, "loss_rate"),
    duplicates: requiredCsvNumber(valueByHeader, "duplicates"),
    e2eP50Ms: requiredCsvNumber(valueByHeader, "p50_ms"),
    e2eP95Ms: requiredCsvNumber(valueByHeader, "p95_ms"),
    e2eP99Ms: requiredCsvNumber(valueByHeader, "p99_ms"),
  };
}

function requiredCsvNumber(values: Map<string, string | undefined>, key: string): number {
  const value = Number(values.get(key));
  if (!Number.isFinite(value)) {
    throw new Error(`Missing numeric reconcile column: ${key}`);
  }
  return value;
}

function requiredNumber(metric: Metric | undefined, key: string): number {
  const value = metric?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing numeric k6 metric: ${key}`);
  }
  return value;
}
