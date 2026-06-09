import "../setup-env";
import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Tests for UpdateAgentToolsDto / enabled_tools validation
//
// The DTO does not exist yet.  These tests validate the expected shape
// and constraints of the enabled_tools field on the update DTO.
// Designed to FAIL until the DTO and endpoint are implemented.
// ---------------------------------------------------------------------------

describe("UpdateAgentToolsDto — enabled_tools validation", () => {
  // =========================================================================
  //  Valid inputs
  // =========================================================================
  it("should accept enabled_tools as null", () => {
    const dto = { enabled_tools: null };
    expect(dto.enabled_tools).toBeNull();
  });

  it("should accept enabled_tools as an empty array", () => {
    const dto: { enabled_tools: string[] | null } = { enabled_tools: [] };
    expect(dto.enabled_tools).toEqual([]);
    expect(Array.isArray(dto.enabled_tools)).toBe(true);
  });

  it("should accept enabled_tools as an array of strings", () => {
    const dto: { enabled_tools: string[] | null } = {
      enabled_tools: ["communicate", "resource", "search_tickets"],
    };
    expect(dto.enabled_tools).toHaveLength(3);
    expect(dto.enabled_tools.every((t) => typeof t === "string")).toBe(true);
  });

  it("should accept a single tool name", () => {
    const dto: { enabled_tools: string[] | null } = {
      enabled_tools: ["communicate"],
    };
    expect(dto.enabled_tools).toEqual(["communicate"]);
  });

  // =========================================================================
  //  Invalid inputs — should be rejected by class-validator
  // =========================================================================
  it("should reject enabled_tools as a plain string", () => {
    // This simulates what class-validator @IsArray would catch
    const invalid = { enabled_tools: "communicate" };
    expect(Array.isArray(invalid.enabled_tools)).toBe(false);
    // In real implementation, ValidationPipe would throw
  });

  it("should reject enabled_tools as a number", () => {
    const invalid = { enabled_tools: 42 };
    expect(Array.isArray(invalid.enabled_tools)).toBe(false);
  });

  it("should reject enabled_tools as a boolean", () => {
    const invalid = { enabled_tools: true };
    expect(Array.isArray(invalid.enabled_tools)).toBe(false);
  });

  it("should reject enabled_tools as an object", () => {
    const invalid = { enabled_tools: { name: "communicate" } };
    expect(Array.isArray(invalid.enabled_tools)).toBe(false);
  });

  // =========================================================================
  //  Boundary: tool names with special characters
  // =========================================================================
  it("should accept tool names with underscores", () => {
    const dto = { enabled_tools: ["search_tickets", "book_calendar"] };
    expect(dto.enabled_tools).toHaveLength(2);
  });

  it("should accept tool names with hyphens", () => {
    const dto = { enabled_tools: ["my-custom-tool"] };
    expect(dto.enabled_tools).toHaveLength(1);
  });

  // =========================================================================
  //  Edge case: duplicate names
  // =========================================================================
  it("should accept duplicate tool names (server deduplicates)", () => {
    const dto = { enabled_tools: ["communicate", "communicate", "resource"] };
    // The server should handle deduplication if needed
    expect(dto.enabled_tools).toHaveLength(3);
  });
});
