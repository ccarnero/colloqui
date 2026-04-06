import { describe, it, expect } from "bun:test";
import {
  ingressMessagesReceived,
  ingressPublishDuration,
} from "../../src/modules/ingress/ingress.metrics";

describe("ingress.metrics", () => {
  it("exposes counters and histograms without throwing", () => {
    expect(() => ingressMessagesReceived.add(1)).not.toThrow();
    expect(() => ingressPublishDuration.record(1)).not.toThrow();
  });
});
