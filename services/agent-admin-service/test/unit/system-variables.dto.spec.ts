import "../setup-env";
import "reflect-metadata";
import { describe, it, expect } from "bun:test";
import { validate } from "class-validator";
import {
  CreateSystemVariableDto,
  UpdateSystemVariableDto,
} from "../../src/modules/system-variables/system-variables.dto";

// ---------------------------------------------------------------------------
// CreateSystemVariableDto
// ---------------------------------------------------------------------------
describe("CreateSystemVariableDto", () => {
  it("validates required fields (name, type, value)", async () => {
    const dto = new CreateSystemVariableDto();
    // No properties set — all required fields are missing
    const errors = await validate(dto);

    const names = errors.map((e) => e.property);
    expect(names).toContain("name");
    expect(names).toContain("type");
    expect(names).toContain("value");
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid type", async () => {
    const dto = new CreateSystemVariableDto();
    dto.name = "test";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dto.type = "not_a_valid_type" as any;
    dto.value = "hello";

    const errors = await validate(dto);

    const typeErrors = errors.filter((e) => e.property === "type");
    expect(typeErrors.length).toBeGreaterThan(0);
    // The error should be about isIn constraint
    expect(typeErrors[0].constraints).toBeDefined();
    expect(typeErrors[0].constraints!.isIn).toBeDefined();
  });

  it("accepts valid data", async () => {
    const dto = new CreateSystemVariableDto();
    dto.name = "test";
    dto.type = "string";
    dto.value = "hello";

    const errors = await validate(dto);

    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// UpdateSystemVariableDto
// ---------------------------------------------------------------------------
describe("UpdateSystemVariableDto", () => {
  it("allows partial updates (empty object is valid)", async () => {
    const dto = new UpdateSystemVariableDto();
    // All fields are optional — no properties set
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
  });

  it("rejects invalid type", async () => {
    const dto = new UpdateSystemVariableDto();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dto.type = "not_a_valid_type" as any;

    const errors = await validate(dto);

    const typeErrors = errors.filter((e) => e.property === "type");
    expect(typeErrors.length).toBeGreaterThan(0);
    expect(typeErrors[0].constraints).toBeDefined();
    expect(typeErrors[0].constraints!.isIn).toBeDefined();
  });
});
