import { describe, it, expect } from "bun:test";
import { MetricsHandler } from "../../src/handlers/metrics.handler";

describe("MetricsHandler", () => {
  it("handle returns processed true", async () => {
    const h = new MetricsHandler();
    const out = await h.handle("e1", { kind: "counter" });
    expect(out.processed).toBe(true);
  });

  it("exposes metrics event type", () => {
    const h = new MetricsHandler();
    expect(h.eventType).toBe("metrics");
  });
});
