import { describe, expect, test } from "bun:test";

import { buildRunSummary, formatRunSummaryCsvRow } from "./run-summary";

describe("buildRunSummary", () => {
  test("combines k6 and reconcile outputs into a stable comparison row", () => {
    const summary = buildRunSummary({
      label: "cap4-50rps",
      targetRate: 50,
      duration: "2m",
      k6Summary: {
        metrics: {
          phase1_webhook_sent: { count: 5982, rate: 49.84899429654007 },
          phase1_webhook_ack_ms: {
            "p(95)": 436.64814999999965,
            "p(99)": 1486.3734999999997,
            max: 2637.07,
          },
          dropped_iterations: { count: 17 },
          http_req_failed: { value: 0 },
        },
      },
      reconcileCsv:
        "stage,sent,delivered,lost,loss_rate,duplicates,p50_ms,p95_ms,p99_ms,min_ms,max_ms,mean_ms\n" +
        "medium,5982,5968,14,0.002340,0,251029.95,491301.80,513053.59,22325.00,545693.00,274610.37\n",
    });

    expect(summary).toEqual({
      label: "cap4-50rps",
      targetRate: 50,
      duration: "2m",
      sent: 5982,
      actualRate: 49.84899429654007,
      httpFailureRate: 0,
      ackP95Ms: 436.64814999999965,
      ackP99Ms: 1486.3734999999997,
      ackMaxMs: 2637.07,
      droppedIterations: 17,
      delivered: 5968,
      lost: 14,
      lossRate: 0.00234,
      duplicates: 0,
      e2eP50Ms: 251029.95,
      e2eP95Ms: 491301.8,
      e2eP99Ms: 513053.59,
    });
  });
});

describe("formatRunSummaryCsvRow", () => {
  test("formats a comparison row with stable column ordering", () => {
    expect(
      formatRunSummaryCsvRow({
        label: "cap4-50rps",
        targetRate: 50,
        duration: "2m",
        sent: 5982,
        actualRate: 49.84899429654007,
        httpFailureRate: 0,
        ackP95Ms: 436.64814999999965,
        ackP99Ms: 1486.3734999999997,
        ackMaxMs: 2637.07,
        droppedIterations: 17,
        delivered: 5968,
        lost: 14,
        lossRate: 0.00234,
        duplicates: 0,
        e2eP50Ms: 251029.95,
        e2eP95Ms: 491301.8,
        e2eP99Ms: 513053.59,
      }),
    ).toBe(
      "cap4-50rps,50,2m,5982,49.85,0.000000,436.65,1486.37,2637.07,17,5968,14,0.002340,0,251029.95,491301.80,513053.59",
    );
  });
});
