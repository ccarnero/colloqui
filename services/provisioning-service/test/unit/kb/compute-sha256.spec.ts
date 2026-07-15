import { describe, expect, it } from "bun:test";
import { computeSha256 } from "../../../src/modules/kb/lib/compute-sha256";

describe("computeSha256", () => {
  it("is deterministic for the same content", () => {
    expect(computeSha256("hello world")).toBe(computeSha256("hello world"));
  });

  it("differs for different content", () => {
    expect(computeSha256("hello")).not.toBe(computeSha256("world"));
  });

  it("matches the well-known sha256 of 'abc'", () => {
    expect(computeSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes Buffer input identically to the equivalent string", () => {
    expect(computeSha256(Buffer.from("hello", "utf8"))).toBe(
      computeSha256("hello")
    );
  });
});
