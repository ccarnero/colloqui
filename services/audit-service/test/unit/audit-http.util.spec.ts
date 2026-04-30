import { describe, it, expect } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { assertFoundOrThrow } from "../../src/common/audit-http.util";

describe("assertFoundOrThrow", () => {
  it("returns the row when defined", () => {
    const row = { id: "1" };
    expect(assertFoundOrThrow(row, "missing")).toBe(row);
  });

  it("throws NotFoundException when row is null", () => {
    expect(() => assertFoundOrThrow(null, "x")).toThrow(NotFoundException);
    expect(() => assertFoundOrThrow(null, "x")).toThrow("x");
  });

  it("throws NotFoundException when row is undefined", () => {
    expect(() => assertFoundOrThrow(undefined, "y")).toThrow(NotFoundException);
  });
});
