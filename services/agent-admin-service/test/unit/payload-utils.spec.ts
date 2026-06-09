import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import {
  calculateChecksum,
  serializeCanonicalPayload,
} from "../../src/utils/payload-utils";

describe("payload-utils", () => {
  it("serializeCanonicalPayload sorts object keys for stable JSON", () => {
    const a = serializeCanonicalPayload({ z: 1, a: 2 });
    const b = serializeCanonicalPayload({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it("calculateChecksum matches for different key orders", () => {
    expect(calculateChecksum({ a: 1, b: 2 })).toBe(
      calculateChecksum({ b: 2, a: 1 }),
    );
  });

  it("calculateChecksum prefixes sha256", () => {
    const h = calculateChecksum({ x: 1 });
    expect(h.startsWith("sha256:")).toBe(true);
    expect(h.length).toBeGreaterThan(10);
  });
});
