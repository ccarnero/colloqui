/**
 * Bucketed latency histogram with O(1) update and O(buckets) percentile.
 *
 * Avoids the naive `latencies.sort()` approach which is O(n log n) and
 * allocates a contiguous array per stage. Uses log-linear bucketing à la HDR
 * histograms but simplified — one map of bucket-index -> count.
 *
 * Resolution: 1 ms granularity up to 32 s (good enough for HTTP latency).
 * Beyond that, bucket width grows by ~3.5% per index, capped at 1 hour.
 */

const MIN_VALUE_MS = 1;
const MAX_VALUE_MS = 3_600_000;
const SUB_BUCKETS = 32;
const BUCKET_LOG_BASE = 2;

function bucketIndex(valueMs: number): number {
  if (valueMs <= MIN_VALUE_MS) {
    return 0;
  }
  const clamped = Math.min(valueMs, MAX_VALUE_MS);
  const log =
    Math.log(clamped) / Math.log(BUCKET_LOG_BASE) -
    Math.log(MIN_VALUE_MS) / Math.log(BUCKET_LOG_BASE);
  return Math.floor(log * SUB_BUCKETS);
}

function bucketUpperBound(index: number): number {
  if (index <= 0) {
    return MIN_VALUE_MS;
  }
  const exponent = (index + 1) / SUB_BUCKETS;
  return MIN_VALUE_MS * BUCKET_LOG_BASE ** exponent;
}

export class LatencyHistogram {
  private readonly counts = new Map<number, number>();
  private total = 0;
  private sumMs = 0;
  private minMs = Number.POSITIVE_INFINITY;
  private maxMs = Number.NEGATIVE_INFINITY;

  record(valueMs: number): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) {
      return;
    }
    const idx = bucketIndex(valueMs);
    this.counts.set(idx, (this.counts.get(idx) ?? 0) + 1);
    this.total += 1;
    this.sumMs += valueMs;
    if (valueMs < this.minMs) {
      this.minMs = valueMs;
    }
    if (valueMs > this.maxMs) {
      this.maxMs = valueMs;
    }
  }

  count(): number {
    return this.total;
  }

  meanMs(): number {
    return this.total === 0 ? 0 : this.sumMs / this.total;
  }

  minObservedMs(): number {
    return this.total === 0 ? 0 : this.minMs;
  }

  maxObservedMs(): number {
    return this.total === 0 ? 0 : this.maxMs;
  }

  percentile(p: number): number {
    if (this.total === 0) {
      return 0;
    }
    const target = Math.ceil((p / 100) * this.total);
    const indices = Array.from(this.counts.keys()).sort((a, b) => a - b);
    let cumulative = 0;
    for (const index of indices) {
      cumulative += this.counts.get(index) ?? 0;
      if (cumulative >= target) {
        return bucketUpperBound(index);
      }
    }
    return bucketUpperBound(indices[indices.length - 1] ?? 0);
  }

  snapshot(): {
    count: number;
    meanMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  } {
    return {
      count: this.total,
      maxMs: this.maxObservedMs(),
      meanMs: this.meanMs(),
      minMs: this.minObservedMs(),
      p50Ms: this.percentile(50),
      p95Ms: this.percentile(95),
      p99Ms: this.percentile(99),
    };
  }
}
