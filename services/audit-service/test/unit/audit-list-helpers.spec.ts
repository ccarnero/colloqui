import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import {
  parseAuditPagination,
  toAuditListResult,
} from "../../src/common/audit-list-helpers";

describe("audit-list-helpers", () => {
  it("parseAuditPagination clamps via shared helpers", () => {
    const p = parseAuditPagination(9999, -1);
    expect(typeof p.limit).toBe("number");
    expect(typeof p.offset).toBe("number");
    expect(p.limit).toBeGreaterThan(0);
    expect(p.offset).toBeGreaterThanOrEqual(0);
  });

  it("toAuditListResult wraps events with pagination", () => {
    const r = toAuditListResult([{ id: "1" }], 10, 0);
    expect(r.events).toEqual([{ id: "1" }]);
    expect(r.limit).toBe(10);
    expect(r.offset).toBe(0);
  });
});
