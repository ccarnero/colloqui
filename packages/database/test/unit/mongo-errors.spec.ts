import { describe, expect, it } from "bun:test";
import { isMongoDuplicateKeyError, isFatalMongoError } from "../../src/mongo-errors";

describe("isMongoDuplicateKeyError", () => {
  it("returns true for error code 11000", () => {
    expect(isMongoDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it("returns true for bulk write duplicate errors", () => {
    expect(
      isMongoDuplicateKeyError({
        writeErrors: [{ code: 11000 }],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isMongoDuplicateKeyError(new Error("network"))).toBe(false);
  });
});

describe("isFatalMongoError", () => {
  it("returns true for authentication failures", () => {
    expect(
      isFatalMongoError({ message: "Authentication failed" }),
    ).toBe(true);
  });

  it("returns true for topology and server selection failures", () => {
    expect(isFatalMongoError({ message: "Topology is closed" })).toBe(true);
    expect(
      isFatalMongoError({
        message: "Server selection timed out after 30000 ms",
      }),
    ).toBe(true);
  });

  it("returns false for transient network errors", () => {
    expect(isFatalMongoError({ message: "connection reset" })).toBe(false);
  });
});
