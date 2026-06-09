import "../setup-env";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateMemoryDto } from "../../src/modules/memory/dto/update-memory.dto";

describe("UpdateMemoryDto validation", () => {
  it("should pass with empty dto", async () => {
    const dto = plainToInstance(UpdateMemoryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should pass with valid title", async () => {
    const dto = plainToInstance(UpdateMemoryDto, { title: "Updated Title" });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when title exceeds 500 chars", async () => {
    const dto = plainToInstance(UpdateMemoryDto, { title: "a".repeat(501) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "title")).toBe(true);
  });

  it("should pass with valid content", async () => {
    const dto = plainToInstance(UpdateMemoryDto, { content: "Updated content" });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should fail when content exceeds 50000 chars", async () => {
    const dto = plainToInstance(UpdateMemoryDto, { content: "a".repeat(50_001) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "content")).toBe(true);
  });

  it("should pass with valid metadata", async () => {
    const dto = plainToInstance(UpdateMemoryDto, { metadata: { key: "value" } });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("should pass with all fields", async () => {
    const dto = plainToInstance(UpdateMemoryDto, {
      title: "Updated Title",
      content: "Updated Content",
      metadata: { updated: true },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
