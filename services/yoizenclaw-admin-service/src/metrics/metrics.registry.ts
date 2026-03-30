import { metrics } from "@opentelemetry/api";

export interface MetricTags {
  tenant?: string;
  channel?: string;
  provider?: string;
  [key: string]: string | undefined;
}

type CounterHandle = { increment(tags?: MetricTags): void };
type HistogramHandle = { record(value: number, tags?: MetricTags): void };
type GaugeHandle = { record(value: number, tags?: MetricTags): void };

function sanitizeTags(tags?: MetricTags): Record<string, string> {
  if (!tags) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value !== undefined && value !== null) {
      sanitized[key] = String(value);
    }
  }
  return sanitized;
}

class NoopCounter implements CounterHandle {
  increment(_tags?: MetricTags): void {}
}

class NoopHistogram implements HistogramHandle {
  record(_value: number, _tags?: MetricTags): void {}
}

class NoopGauge implements GaugeHandle {
  record(_value: number, _tags?: MetricTags): void {}
}

class OtelCounter implements CounterHandle {
  private readonly counter: ReturnType<
    ReturnType<typeof metrics.getMeter>["createCounter"]
  >;

  constructor(
    meter: ReturnType<typeof metrics.getMeter>,
    name: string,
    description?: string,
  ) {
    this.counter = meter.createCounter(name, { description });
  }

  increment(tags?: MetricTags): void {
    this.counter.add(1, sanitizeTags(tags));
  }
}

class OtelHistogram implements HistogramHandle {
  private readonly histogram: ReturnType<
    ReturnType<typeof metrics.getMeter>["createHistogram"]
  >;

  constructor(
    meter: ReturnType<typeof metrics.getMeter>,
    name: string,
    description?: string,
  ) {
    this.histogram = meter.createHistogram(name, {
      description,
      unit: "ms",
    });
  }

  record(value: number, tags?: MetricTags): void {
    this.histogram.record(value, sanitizeTags(tags));
  }
}

class OtelGauge implements GaugeHandle {
  private readonly gauge: ReturnType<
    ReturnType<typeof metrics.getMeter>["createUpDownCounter"]
  >;

  constructor(
    meter: ReturnType<typeof metrics.getMeter>,
    name: string,
    description?: string,
  ) {
    this.gauge = meter.createUpDownCounter(name, { description });
  }

  record(value: number, tags?: MetricTags): void {
    this.gauge.add(value, sanitizeTags(tags));
  }
}

export class MetricsRegistry {
  private readonly meterName: string;
  private meter: ReturnType<typeof metrics.getMeter> | null = null;

  constructor(meterName = "yoizenclaw-admin-service") {
    this.meterName = meterName;
  }

  private getMeter(): ReturnType<typeof metrics.getMeter> | null {
    if (this.meter) return this.meter;
    try {
      const provider = metrics.getMeterProvider();
      this.meter = provider.getMeter(this.meterName);
      return this.meter;
    } catch {
      // OpenTelemetry not configured — metrics will be no-ops
    }
    return null;
  }

  counter(name: string, description?: string): CounterHandle {
    const meter = this.getMeter();
    if (!meter) return new NoopCounter();
    return new OtelCounter(meter, name, description);
  }

  histogram(name: string, description?: string): HistogramHandle {
    const meter = this.getMeter();
    if (!meter) return new NoopHistogram();
    return new OtelHistogram(meter, name, description);
  }

  gauge(name: string, description?: string): GaugeHandle {
    const meter = this.getMeter();
    if (!meter) return new NoopGauge();
    return new OtelGauge(meter, name, description);
  }
}

export const globalMetricsRegistry = new MetricsRegistry();
