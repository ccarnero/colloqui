import { describe, it, expect } from "bun:test";
import { hashSecret } from "../../src/utils/password";

describe("hashSecret", () => {
  it("produces an argon2id hash string", async () => {
    const h = await hashSecret("unit-test-secret");
    expect(h.length).toBeGreaterThan(20);
    expect(h.startsWith("$argon2")).toBe(true);
  });

  it("uses random salt so identical inputs yield different hashes", async () => {
    const a = await hashSecret("x");
    const b = await hashSecret("x");
    expect(a).not.toBe(b);
    expect(a.startsWith("$argon2")).toBe(true);
    expect(b.startsWith("$argon2")).toBe(true);
  });
});
