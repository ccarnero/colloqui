import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { StateMergerService } from "../../src/modules/tools/state-merger.service";

describe("StateMergerService", () => {
  let service: StateMergerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StateMergerService],
    }).compile();

    service = moduleRef.get(StateMergerService);
  });

  describe("mergeState", () => {
    it("should merge a plain object result into existing state", () => {
      const state: Record<string, unknown> = { existing: "data" };

      service.mergeState(state, { key: "value" });

      expect(state).toEqual({ existing: "data", key: "value" });
    });

    it("should mutate the same state object reference (in-place mutation)", () => {
      const state: Record<string, unknown> = { existing: "data" };
      const originalRef = state;

      service.mergeState(state, { key: "value" });

      expect(state).toBe(originalRef);
      expect(state).toEqual({ existing: "data", key: "value" });
    });

    it("should merge a deeply nested object result", () => {
      const state: Record<string, unknown> = {};

      service.mergeState(state, { nested: { a: 1, b: { c: 2, d: [3, 4] } } });

      expect(state).toEqual({ nested: { a: 1, b: { c: 2, d: [3, 4] } } });
    });

    it("should preserve array values in state when part of result", () => {
      const state: Record<string, unknown> = {};

      service.mergeState(state, { items: [1, 2, 3], names: ["a", "b"] });

      expect(state).toEqual({ items: [1, 2, 3], names: ["a", "b"] });
    });

    it.each([
      [null, "null"],
      [undefined, "undefined"],
    ])("should not modify state when result is %s", (result, _label) => {
      const state: Record<string, unknown> = { existing: "data" };

      service.mergeState(state, result as unknown);

      expect(state).toEqual({ existing: "data" });
    });

    it.each([
      ["a plain string", "hello"],
      ["a number", 42],
      ["a boolean", false],
    ])("should not modify state when result is %s", (_label, result) => {
      const state: Record<string, unknown> = { existing: "data" };

      service.mergeState(state, result as unknown);

      expect(state).toEqual({ existing: "data" });
    });

    it("should NOT overwrite a string message with a non-string value", () => {
      const state: Record<string, unknown> = { message: "hello" };

      service.mergeState(state, { message: { complex: true } });

      expect(state.message).toBe("hello");
    });

    it("should skip only the message key when guard triggers, merging other keys", () => {
      const state: Record<string, unknown> = { message: "hello" };

      service.mergeState(state, {
        message: { complex: true },
        other: "value",
        count: 42,
      });

      expect(state).toEqual({ message: "hello", other: "value", count: 42 });
    });

    it("should overwrite message when existing value is not a string", () => {
      const state: Record<string, unknown> = { message: 123 };

      service.mergeState(state, { message: "new" });

      expect(state.message).toBe("new");
    });

    it("should overwrite message when both existing and new values are strings", () => {
      const state: Record<string, unknown> = { message: "old" };

      service.mergeState(state, { message: "new" });

      expect(state.message).toBe("new");
    });

    it("should overwrite message when existing value is null", () => {
      const state: Record<string, unknown> = { message: null };

      service.mergeState(state, { message: "new message" });

      expect(state.message).toBe("new message");
    });

    it("should NOT modify state when result is an empty object", () => {
      const state: Record<string, unknown> = { existing: "data" };

      service.mergeState(state, {});

      expect(state).toEqual({ existing: "data" });
    });

    it("should preserve various primitive value types in state", () => {
      const state: Record<string, unknown> = {};

      service.mergeState(state, {
        num: 42,
        bool: true,
        nullable: null,
        str: "text",
        undef: undefined,
      });

      expect(state).toEqual({
        num: 42,
        bool: true,
        nullable: null,
        str: "text",
        undef: undefined,
      });
    });

    it("should serialize objects with toJSON() before merging", () => {
      const state: Record<string, unknown> = {};
      const obj = {
        data: "ignore-me",
        toJSON() {
          return { key: "serialized" };
        },
      };

      service.mergeState(state, obj);

      expect(state).toEqual({ key: "serialized" });
    });

    it("should not merge when toJSON() returns a non-object (string)", () => {
      const state: Record<string, unknown> = { existing: "data" };
      const obj = {
        toJSON() {
          return "string-result";
        },
      };

      service.mergeState(state, obj);

      expect(state).toEqual({ existing: "data" });
    });

    it("should not merge when toJSON() returns a non-object (number)", () => {
      const state: Record<string, unknown> = { existing: "data" };
      const obj = {
        toJSON() {
          return 99;
        },
      };

      service.mergeState(state, obj);

      expect(state).toEqual({ existing: "data" });
    });

    it("should not merge when toJSON() returns null", () => {
      const state: Record<string, unknown> = { existing: "data" };
      const obj = {
        toJSON() {
          return null;
        },
      };

      service.mergeState(state, obj);

      expect(state).toEqual({ existing: "data" });
    });

    it("should merge when toJSON() returns a nested plain object", () => {
      const state: Record<string, unknown> = {};
      const obj = {
        toJSON() {
          return { level1: { level2: "deep" } };
        },
      };

      service.mergeState(state, obj);

      expect(state).toEqual({ level1: { level2: "deep" } });
    });

    it("should NOT merge when result is an array", () => {
      const state: Record<string, unknown> = { existing: "data" };

      service.mergeState(state, [1, 2, 3]);

      expect(state).toEqual({ existing: "data" });
    });

    it("should merge objects with null prototype", () => {
      const state: Record<string, unknown> = {};
      const nullProto = Object.create(null);
      nullProto.key = "from-null-proto";

      service.mergeState(state, nullProto);

      expect(state).toEqual({ key: "from-null-proto" });
    });

    it("should NOT merge Date objects (not a plain object, has toJSON)", () => {
      const state: Record<string, unknown> = { existing: "data" };
      const date = new Date("2026-01-15T00:00:00Z");

      service.mergeState(state, date as unknown);

      expect(state).toEqual({ existing: "data" });
    });

    it("should merge multiple keys in a single call", () => {
      const state: Record<string, unknown> = { existing: true };

      service.mergeState(state, { a: 1, b: "two", c: null, d: { nested: true } });

      expect(state).toEqual({ existing: true, a: 1, b: "two", c: null, d: { nested: true } });
    });

    it("should overwrite existing keys with new values from result", () => {
      const state: Record<string, unknown> = { key: "old", untouched: "keep" };

      service.mergeState(state, { key: "new" });

      expect(state).toEqual({ key: "new", untouched: "keep" });
    });

    it("should handle sequential merge calls accumulating state", () => {
      const state: Record<string, unknown> = {};

      service.mergeState(state, { step1: "done" });
      service.mergeState(state, { step2: "done" });
      service.mergeState(state, { step3: "done" });

      expect(state).toEqual({ step1: "done", step2: "done", step3: "done" });
    });

    it("should preserve frozen objects in result as-is (no deep clone)", () => {
      const state: Record<string, unknown> = {};
      const frozen = Object.freeze({ frozenKey: "value" });

      service.mergeState(state, { frozen });

      expect(state).toEqual({ frozen: { frozenKey: "value" } });
      expect(Object.isFrozen((state as any).frozen)).toBe(true);
    });

    it("should handle an object with a custom prototype that returns a plain object from toJSON()", () => {
      const state: Record<string, unknown> = {};
      class CustomDto {
        name = "test";
        toJSON() {
          return { name: this.name, type: "custom" };
        }
      }

      service.mergeState(state, new CustomDto());

      expect(state).toEqual({ name: "test", type: "custom" });
    });

    it("should preserve symbol-keyed properties when result has them (merged as-is)", () => {
      const sym = Symbol("private");
      const state: Record<string, unknown> = {};
      const result = { [sym]: "symbol-value", visible: "key" };

      service.mergeState(state, result);

      // Object.entries does NOT include symbol keys, so only visible is merged
      expect(state).toEqual({ visible: "key" });
      expect((state as any)[sym]).toBeUndefined();
    });
  });
});
