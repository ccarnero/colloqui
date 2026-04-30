import { describe, it, expect } from "bun:test";
import { egressMessagesSent } from "../../src/modules/egress/egress.metrics";

describe("egress.metrics", () => {
  it("exposes counters without throwing", () => {
    expect(() => egressMessagesSent.add(1)).not.toThrow();
  });
});
