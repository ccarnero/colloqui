import "../setup-env";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { MemoryQueryDto, MemoryQueryScope, MemoryQueryKind, MemoryQueryStatus } from "../../src/modules/memory/dto/memory-query.dto";

describe("MemoryQueryDto validation", () => {
  it("should pass with empty query", async () => {
    const dto = plainToInstance(MemoryQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should pass with valid scope", async () => {
    const dto = plainToInstance(MemoryQueryDto, { scope: MemoryQueryScope.SESSION });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail with invalid scope", async () => {
    const dto = plainToInstance(MemoryQueryDto, { scope: "INVALID" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "scope")).toBe(true);
  });

  it("should pass with valid kind", async () => {
    const dto = plainToInstance(MemoryQueryDto, { kind: MemoryQueryKind.FACT });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail with invalid kind", async () => {
    const dto = plainToInstance(MemoryQueryDto, { kind: "INVALID" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "kind")).toBe(true);
  });

  it("should pass with valid status", async () => {
    const dto = plainToInstance(MemoryQueryDto, { status: MemoryQueryStatus.ACTIVE });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail with invalid status", async () => {
    const dto = plainToInstance(MemoryQueryDto, { status: "INVALID" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "status")).toBe(true);
  });

  it("should pass with valid boolean includeExpired", async () => {
    const dto = plainToInstance(MemoryQueryDto, { includeExpired: true });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail with invalid boolean includeExpired", async () => {
    const dto = plainToInstance(MemoryQueryDto, { includeExpired: "yes" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "includeExpired")).toBe(true);
  });

  it("should pass with valid limit", async () => {
    const dto = plainToInstance(MemoryQueryDto, { limit: 50 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when limit is below 1", async () => {
    const dto = plainToInstance(MemoryQueryDto, { limit: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "limit")).toBe(true);
  });

  it("should fail when limit exceeds 500", async () => {
    const dto = plainToInstance(MemoryQueryDto, { limit: 501 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "limit")).toBe(true);
  });

  it("should pass with valid offset", async () => {
    const dto = plainToInstance(MemoryQueryDto, { offset: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when offset is negative", async () => {
    const dto = plainToInstance(MemoryQueryDto, { offset: -1 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "offset")).toBe(true);
  });

  it("should pass with all query fields", async () => {
    const dto = plainToInstance(MemoryQueryDto, {
      scope: MemoryQueryScope.USER,
      kind: MemoryQueryKind.PREFERENCE,
      status: MemoryQueryStatus.PROPOSED,
      includeExpired: false,
      sessionId: "sess-1",
      userId: "user-1",
      search: "test",
      context: "ctx",
      limit: 10,
      offset: 5,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
