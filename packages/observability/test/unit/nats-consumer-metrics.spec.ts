import { describe, it, expect, beforeEach, mock } from "bun:test";

type MockMap = Map<string, { add?: any; record?: any }>;

function installMeterMock(): {
  instruments: MockMap;
  calls: {
    counterAdd: Array<{ name: string; value: number; attrs: any }>;
    histogramRecord: Array<{ name: string; value: number; attrs: any }>;
    updownAdd: Array<{ name: string; value: number; attrs: any }>;
  };
} {
  const instruments: MockMap = new Map();
  const calls = {
    counterAdd: [] as Array<{ name: string; value: number; attrs: any }>,
    histogramRecord: [] as Array<{ name: string; value: number; attrs: any }>,
    updownAdd: [] as Array<{ name: string; value: number; attrs: any }>,
  };

  const fakeMeter = {
    createCounter(name: string) {
      const inst = {
        add: (value: number, attrs: any) =>
          calls.counterAdd.push({ name, value, attrs }),
      };
      instruments.set(`counter:${name}`, inst);
      return inst;
    },
    createHistogram(name: string) {
      const inst = {
        record: (value: number, attrs: any) =>
          calls.histogramRecord.push({ name, value, attrs }),
      };
      instruments.set(`histogram:${name}`, inst);
      return inst;
    },
    createUpDownCounter(name: string) {
      const inst = {
        add: (value: number, attrs: any) =>
          calls.updownAdd.push({ name, value, attrs }),
      };
      instruments.set(`updown:${name}`, inst);
      return inst;
    },
  };

  mock.module("@opentelemetry/api", () => ({
    metrics: {
      getMeter: () => fakeMeter,
    },
  }));

  return { instruments, calls };
}

describe("createNatsConsumerMetrics", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("creates the three expected OpenTelemetry instruments", async () => {
    const { instruments } = installMeterMock();
    const {
      createNatsConsumerMetrics,
      __resetNatsConsumerMetricsCacheForTests,
    } = await import("../../src/nats-consumer-metrics");
    __resetNatsConsumerMetricsCacheForTests();

    createNatsConsumerMetrics("event-processor");

    expect(instruments.has("counter:nats.consumer.messages.processed")).toBe(
      true,
    );
    expect(
      instruments.has("histogram:nats.consumer.processing.duration"),
    ).toBe(true);
    expect(instruments.has("updown:nats.consumer.in_flight")).toBe(true);
  });

  it("is idempotent per service name (cached sink)", async () => {
    installMeterMock();
    const {
      createNatsConsumerMetrics,
      __resetNatsConsumerMetricsCacheForTests,
    } = await import("../../src/nats-consumer-metrics");
    __resetNatsConsumerMetricsCacheForTests();

    const a = createNatsConsumerMetrics("svc-a");
    const b = createNatsConsumerMetrics("svc-a");
    expect(a).toBe(b);
  });

  it("recordProcessed emits to the counter with durable + result labels", async () => {
    const { calls } = installMeterMock();
    const {
      createNatsConsumerMetrics,
      __resetNatsConsumerMetricsCacheForTests,
    } = await import("../../src/nats-consumer-metrics");
    __resetNatsConsumerMetricsCacheForTests();

    const sink = createNatsConsumerMetrics("audit-service");
    sink.recordProcessed("channel-audit", "ack");
    sink.recordProcessed("channel-audit", "nak");
    sink.recordProcessed("channel-audit", "term");

    expect(calls.counterAdd).toHaveLength(3);
    expect(calls.counterAdd[0]).toEqual({
      name: "nats.consumer.messages.processed",
      value: 1,
      attrs: { durable: "channel-audit", result: "ack" },
    });
    expect(calls.counterAdd[2]?.attrs.result).toBe("term");
  });

  it("recordDuration emits ms values to the histogram with durable label", async () => {
    const { calls } = installMeterMock();
    const {
      createNatsConsumerMetrics,
      __resetNatsConsumerMetricsCacheForTests,
    } = await import("../../src/nats-consumer-metrics");
    __resetNatsConsumerMetricsCacheForTests();

    const sink = createNatsConsumerMetrics("webhook-service");
    sink.recordDuration("webhook-dispatcher", 12.5);

    expect(calls.histogramRecord).toHaveLength(1);
    expect(calls.histogramRecord[0]).toEqual({
      name: "nats.consumer.processing.duration",
      value: 12.5,
      attrs: { durable: "webhook-dispatcher" },
    });
  });

  it("adjustInFlight emits positive and negative deltas to the updown counter", async () => {
    const { calls } = installMeterMock();
    const {
      createNatsConsumerMetrics,
      __resetNatsConsumerMetricsCacheForTests,
    } = await import("../../src/nats-consumer-metrics");
    __resetNatsConsumerMetricsCacheForTests();

    const sink = createNatsConsumerMetrics("workflow-service");
    sink.adjustInFlight("workflow-triggers", 1);
    sink.adjustInFlight("workflow-triggers", -1);

    expect(calls.updownAdd).toEqual([
      {
        name: "nats.consumer.in_flight",
        value: 1,
        attrs: { durable: "workflow-triggers" },
      },
      {
        name: "nats.consumer.in_flight",
        value: -1,
        attrs: { durable: "workflow-triggers" },
      },
    ]);
  });
});
