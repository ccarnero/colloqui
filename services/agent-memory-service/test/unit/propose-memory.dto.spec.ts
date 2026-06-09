import "../setup-env";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ProposeMemoryDto, MemoryScope, MemoryKind } from "../../src/modules/memory/dto/propose-memory.dto";

describe("ProposeMemoryDto validation", () => {
  it("should pass with valid data", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: MemoryKind.FACT,
      title: "Valid Title",
      content: "Valid content",
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when scope is missing", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      kind: MemoryKind.FACT,
      title: "Valid Title",
      content: "Valid content",
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === "scope")).toBe(true);
  });

  it("should fail when kind is invalid", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: "INVALID_KIND",
      title: "Valid Title",
      content: "Valid content",
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "kind")).toBe(true);
  });

  it("should fail when title is empty", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: MemoryKind.FACT,
      title: "",
      content: "Valid content",
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
  });

  it("should fail when title exceeds 500 chars", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: MemoryKind.FACT,
      title: "a".repeat(501),
      content: "Valid content",
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
  });

  it("should fail when content is empty", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: MemoryKind.FACT,
      title: "Valid Title",
      content: "",
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "content")).toBe(true);
  });

  it("should fail when content exceeds 50000 chars", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: MemoryKind.FACT,
      title: "Valid Title",
      content: "a".repeat(50_001),
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "content")).toBe(true);
  });

  it("should pass with all optional fields", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.USER,
      kind: MemoryKind.PREFERENCE,
      title: "Valid Title",
      content: "Valid content",
      userId: "user-1",
      sessionId: "session-1",
      metadata: { key: "value" },
      topicKey: "topic-1",
      ttl: 3600,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when ttl is not a number", async () => {
    const dto = plainToInstance(ProposeMemoryDto, {
      scope: MemoryScope.SESSION,
      kind: MemoryKind.FACT,
      title: "Valid Title",
      content: "Valid content",
      ttl: "not-a-number",
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "ttl")).toBe(true);
  });
});
