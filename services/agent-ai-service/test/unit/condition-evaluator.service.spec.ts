import { describe, it, expect, mock, beforeEach } from "bun:test";

// ── Logger mock ──────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer, not constructor-injected.
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import { ConditionEvaluatorService } from "../../src/modules/condition-evaluator/condition-evaluator.service";

// ── Helpers ──────────────────────────────────────────────────────────────

function createService(): ConditionEvaluatorService {
  return new ConditionEvaluatorService();
}

// ── Suite ────────────────────────────────────────────────────────────────

describe("ConditionEvaluatorService", () => {
  let service: ConditionEvaluatorService;

  beforeEach(() => {
    service = createService();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Non-string conditions (direct returns — no parsing)
  // ──────────────────────────────────────────────────────────────────────────

  describe("non-string conditions", () => {
    it('should return true when condition is null', () => {
      expect(service.shouldRunStep(null, {})).toBe(true);
    });

    it('should return true when condition is undefined', () => {
      expect(service.shouldRunStep(undefined, {})).toBe(true);
    });

    it('should return true when condition is true', () => {
      expect(service.shouldRunStep(true, {})).toBe(true);
    });

    it('should return false when condition is false', () => {
      expect(service.shouldRunStep(false, {})).toBe(false);
    });

    it('should return true when condition is an empty string', () => {
      expect(service.shouldRunStep("", {})).toBe(true);
    });

    it('should return true when condition is whitespace-only string', () => {
      expect(service.shouldRunStep("   \t\n  ", {})).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Basic comparisons (== and !=)
  // ──────────────────────────────────────────────────────────────────────────

  describe("basic comparisons", () => {
    it('should return true for number equality that matches', () => {
      expect(service.shouldRunStep("a == 1", { a: 1 })).toBe(true);
    });

    it('should return false for number equality that does not match', () => {
      expect(service.shouldRunStep("a == 1", { a: 2 })).toBe(false);
    });

    it('should return true for number inequality that differs', () => {
      expect(service.shouldRunStep("a != 1", { a: 2 })).toBe(true);
    });

    it('should return false for number inequality that matches', () => {
      expect(service.shouldRunStep("a != 1", { a: 1 })).toBe(false);
    });

    it('should compare string equality with double-quoted literal', () => {
      expect(service.shouldRunStep('a == "hello"', { a: "hello" })).toBe(true);
    });

    it('should return false when string does not match', () => {
      expect(service.shouldRunStep('a == "hello"', { a: "world" })).toBe(false);
    });

    it('should compare string equality with single-quoted literal', () => {
      expect(service.shouldRunStep("a == 'hello'", { a: "hello" })).toBe(true);
    });

    it('should compare boolean equality with true', () => {
      expect(service.shouldRunStep("a == true", { a: true })).toBe(true);
    });

    it('should return false when boolean does not match', () => {
      expect(service.shouldRunStep("a == true", { a: false })).toBe(false);
    });

    it('should compare with null literal when state value is null', () => {
      expect(service.shouldRunStep("a == null", { a: null })).toBe(true);
    });

    it('should return false when comparing null with undefined (absent key)', () => {
      // state["a"] === undefined, and undefined !== null
      expect(service.shouldRunStep("a == null", {})).toBe(false);
    });

    it('should compare number with float value', () => {
      expect(service.shouldRunStep("a == 3.14", { a: 3.14 })).toBe(true);
    });

    it('should compare with negative number', () => {
      expect(service.shouldRunStep("a == -1", { a: -1 })).toBe(true);
    });

    it('should return false for mismatched types (number vs string)', () => {
      expect(service.shouldRunStep('a == 42', { a: "42" })).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Logical operators (AND, OR, NOT)
  // ──────────────────────────────────────────────────────────────────────────

  describe("AND operator", () => {
    it('should return true when both sides are true', () => {
      expect(service.shouldRunStep("a == 1 AND b == 2", { a: 1, b: 2 })).toBe(true);
    });

    it('should return false when left side is false', () => {
      expect(service.shouldRunStep("a == 1 AND b == 2", { a: 99, b: 2 })).toBe(false);
    });

    it('should return false when right side is false', () => {
      expect(service.shouldRunStep("a == 1 AND b == 2", { a: 1, b: 99 })).toBe(false);
    });

    it('should return false when both sides are false', () => {
      expect(service.shouldRunStep("a == 1 AND b == 2", { a: 99, b: 99 })).toBe(false);
    });

    it('should chain multiple ANDs — all true', () => {
      expect(service.shouldRunStep("a == 1 AND b == 2 AND c == 3", { a: 1, b: 2, c: 3 })).toBe(true);
    });

    it('should chain multiple ANDs — one false breaks chain', () => {
      expect(service.shouldRunStep("a == 1 AND b == 2 AND c == 3", { a: 1, b: 99, c: 3 })).toBe(false);
    });
  });

  describe("OR operator", () => {
    it('should return true when left side is true', () => {
      expect(service.shouldRunStep("a == 1 OR b == 99", { a: 1, b: 2 })).toBe(true);
    });

    it('should return true when right side is true', () => {
      expect(service.shouldRunStep("a == 99 OR b == 2", { a: 1, b: 2 })).toBe(true);
    });

    it('should return false when both sides are false', () => {
      expect(service.shouldRunStep("a == 99 OR b == 99", { a: 1, b: 2 })).toBe(false);
    });

    it('should chain multiple ORs — any true is sufficient', () => {
      expect(service.shouldRunStep("a == 1 OR b == 2 OR c == 3", { a: 99, b: 2, c: 99 })).toBe(true);
    });

    it('should chain multiple ORs — all false returns false', () => {
      expect(service.shouldRunStep("a == 1 OR b == 2 OR c == 3", { a: 99, b: 99, c: 99 })).toBe(false);
    });
  });

  describe("NOT operator", () => {
    it('should invert false to true', () => {
      expect(service.shouldRunStep("NOT a", { a: false })).toBe(true);
    });

    it('should invert true to false', () => {
      expect(service.shouldRunStep("NOT a", { a: true })).toBe(false);
    });

    it('should treat undefined as falsy — NOT becomes true', () => {
      expect(service.shouldRunStep("NOT a", {})).toBe(true);
    });

    it('should treat 0 as falsy — NOT becomes true', () => {
      expect(service.shouldRunStep("NOT a", { a: 0 })).toBe(true);
    });

    it('should treat empty string as falsy — NOT becomes true', () => {
      expect(service.shouldRunStep("NOT a", { a: "" })).toBe(true);
    });

    it('should treat non-empty string as truthy — NOT becomes false', () => {
      expect(service.shouldRunStep("NOT a", { a: "hello" })).toBe(false);
    });
  });

  describe("mixed logical operators", () => {
    it('should respect AND over OR precedence (AND binds tighter)', () => {
      // Equivalent to: a == 1 OR (b == 2 AND c == 3)
      expect(service.shouldRunStep("a == 1 OR b == 2 AND c == 3", { a: 99, b: 2, c: 3 })).toBe(true);
    });

    it('should evaluate AND first — both conditions needed for OR right side', () => {
      // a == 1 is false, (b == 2 AND c == 99) is false → overall false
      expect(service.shouldRunStep("a == 1 OR b == 2 AND c == 3", { a: 99, b: 2, c: 99 })).toBe(false);
    });

    it('should chain NOT with AND', () => {
      expect(service.shouldRunStep("NOT a AND b == 1", { a: false, b: 1 })).toBe(true);
    });

    it('should chain NOT with OR', () => {
      expect(service.shouldRunStep("NOT a OR b == 1", { a: true, b: 1 })).toBe(true);
    });

    it('should handle double NOT', () => {
      expect(service.shouldRunStep("NOT NOT a", { a: true })).toBe(true);
    });

    it('should handle double NOT with false', () => {
      expect(service.shouldRunStep("NOT NOT a", { a: false })).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Parenthesized expressions
  // ──────────────────────────────────────────────────────────────────────────

  describe("parenthesized expressions", () => {
    it('should evaluate a simple parenthesized true', () => {
      expect(service.shouldRunStep("(true)", {})).toBe(true);
    });

    it('should evaluate a simple parenthesized false', () => {
      expect(service.shouldRunStep("(false)", {})).toBe(false);
    });

    it('should override precedence with parentheses', () => {
      // (a == 1 OR b == 1) AND c == 1
      // Without parens: a == 1 OR (b == 1 AND c == 1)
      // With parens: (a == 1 OR b == 1) AND c == 1
      expect(service.shouldRunStep("(a == 1 OR b == 1) AND c == 1", { a: 99, b: 1, c: 1 })).toBe(true);
    });

    it('should return false when parenthesized OR group is false in AND', () => {
      expect(service.shouldRunStep("(a == 1 OR b == 1) AND c == 1", { a: 99, b: 99, c: 1 })).toBe(false);
    });

    it('should handle deeply nested parentheses', () => {
      expect(service.shouldRunStep("((a == 1) AND (b == 2))", { a: 1, b: 2 })).toBe(true);
    });

    it('should handle three levels of nesting', () => {
      expect(service.shouldRunStep("(((true)))", {})).toBe(true);
    });

    it('should mix parens with NOT inside', () => {
      expect(service.shouldRunStep("(NOT a) AND b == 1", { a: true, b: 1 })).toBe(false);
    });

    it('should handle parens with nested AND/OR mix', () => {
      expect(service.shouldRunStep('(a == 1 OR (b == 2 AND c == 3))', { a: 99, b: 2, c: 3 })).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Dot-path access
  // ──────────────────────────────────────────────────────────────────────────

  describe("dot-path access", () => {
    it('should resolve a single-level dot path', () => {
      expect(service.shouldRunStep('a.b == 1', { a: { b: 1 } })).toBe(true);
    });

    it('should resolve a two-level dot path with string value', () => {
      expect(service.shouldRunStep('a.b.c == "deep"', { a: { b: { c: "deep" } } })).toBe(true);
    });

    it('should return undefined for a missing intermediate path (undefined !== null)', () => {
      // Missing path resolves to undefined, and undefined !== null with ===
      expect(service.shouldRunStep("a.b.c == null", { a: {} })).toBe(false);
    });

    it('should return true with NOT exists for a missing nested path', () => {
      // A more idiomatic way to check "path does not exist"
      expect(service.shouldRunStep('NOT exists(a.b.c)', { a: {} })).toBe(true);
    });

    it('should return false when missing path compared to non-null', () => {
      expect(service.shouldRunStep('a.b.c == "value"', { a: {} })).toBe(false);
    });

    it('should stop traversal and return undefined when intermediate is a primitive', () => {
      // a is a string, so a.b returns undefined; undefined !== null
      expect(service.shouldRunStep("a.b == null", { a: "nope" })).toBe(false);
    });

    it('should return false when comparing missing primitive path to any value', () => {
      expect(service.shouldRunStep('a.b == "value"', { a: "nope" })).toBe(false);
    });

    it('should stop traversal when intermediate is an array (not a plain object)', () => {
      expect(service.shouldRunStep("a.b == null", { a: [1, 2] })).toBe(false);
    });

    it('should handle top-level key that looks like a dot path abbreviation', () => {
      // "context.mode" is a single attribute with path ["context", "mode"]
      expect(service.shouldRunStep('context.mode == "qualify"', { context: { mode: "qualify" } })).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Helper functions (contains, regex, exists)
  // ──────────────────────────────────────────────────────────────────────────

  describe("contains helper", () => {
    it('should return true when substring is found', () => {
      expect(service.shouldRunStep('contains("hello world", "world")', {})).toBe(true);
    });

    it('should return false when substring is not found', () => {
      expect(service.shouldRunStep('contains("hello world", "xyz")', {})).toBe(false);
    });

    it('should work with state variables as arguments', () => {
      expect(service.shouldRunStep('contains(msg, "test")', { msg: "this is a test" })).toBe(true);
    });

    it('should work with dot-path access in arguments', () => {
      expect(service.shouldRunStep('contains(a.b.c, "test")', { a: { b: { c: "nested test value" } } })).toBe(true);
    });

    it('should handle empty strings (empty string always includes empty string)', () => {
      expect(service.shouldRunStep('contains("", "")', {})).toBe(true);
    });

    it('should return false when value is null/undefined', () => {
      expect(service.shouldRunStep('contains(null, "x")', {})).toBe(false);
    });
  });

  describe("regex helper", () => {
    it('should return true when pattern matches', () => {
      expect(service.shouldRunStep('regex("^hello", "hello world")', {})).toBe(true);
    });

    it('should return false when pattern does not match', () => {
      expect(service.shouldRunStep('regex("^xyz", "hello world")', {})).toBe(false);
    });

    it('should be case-insensitive by default', () => {
      expect(service.shouldRunStep('regex("^hello", "HELLO world")', {})).toBe(true);
    });

    it('should work with state variables', () => {
      expect(service.shouldRunStep('regex("^test", msg)', { msg: "test message" })).toBe(true);
    });

    it('should handle null/undefined values gracefully', () => {
      // null/undefined → "" → new RegExp("").test("") → /(?:)/.test("") → true
      expect(service.shouldRunStep('regex(null, null)', {})).toBe(true);
    });
  });

  describe("exists helper", () => {
    it('should return true when value is present and non-empty', () => {
      expect(service.shouldRunStep('exists(name)', { name: "hello" })).toBe(true);
    });

    it('should return false when value is null', () => {
      expect(service.shouldRunStep('exists(name)', { name: null })).toBe(false);
    });

    it('should return false when value is undefined (key absent)', () => {
      expect(service.shouldRunStep('exists(name)', {})).toBe(false);
    });

    it('should return false when value is empty string', () => {
      expect(service.shouldRunStep('exists(name)', { name: "" })).toBe(false);
    });

    it('should return true for number 0 (non-empty string representation)', () => {
      expect(service.shouldRunStep('exists(name)', { name: 0 })).toBe(true);
    });

    it('should return true for boolean false (non-empty string representation)', () => {
      expect(service.shouldRunStep('exists(name)', { name: false })).toBe(true);
    });

    it('should work with dot-path values', () => {
      expect(service.shouldRunStep('exists(a.b)', { a: { b: "present" } })).toBe(true);
    });

    it('should return false for missing dot-path', () => {
      expect(service.shouldRunStep('exists(a.b.c)', { a: {} })).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Invalid / error conditions (all return false via try/catch)
  // ──────────────────────────────────────────────────────────────────────────

  describe("invalid conditions (error recovery)", () => {
    it('should return false for malformed condition with unexpected character', () => {
      expect(service.shouldRunStep("a > 1", { a: 1 })).toBe(false);
    });

    it('should return false for unsupported operator', () => {
      expect(service.shouldRunStep("a >= 1", { a: 1 })).toBe(false);
    });

    it('should return false for incomplete expression (trailing operator)', () => {
      expect(service.shouldRunStep("a AND", { a: 1 })).toBe(false);
    });

    it('should return false for incomplete expression (trailing OR)', () => {
      expect(service.shouldRunStep("a OR", { a: 1 })).toBe(false);
    });

    it('should return false for incomplete expression (just AND)', () => {
      expect(service.shouldRunStep("AND", {})).toBe(false);
    });

    it('should return false for unterminated string literal', () => {
      expect(service.shouldRunStep('a == "hello', {})).toBe(false);
    });

    it('should return false for unknown helper function', () => {
      expect(service.shouldRunStep('unknown("test")', {})).toBe(false);
    });

    it('should return false for mismatched parentheses', () => {
      expect(service.shouldRunStep("(a == 1", { a: 1 })).toBe(false);
    });

    it('should return false for extra closing parenthesis', () => {
      expect(service.shouldRunStep("a == 1)", { a: 1 })).toBe(false);
    });

    it('should return false for empty parenthesized expression', () => {
      // "()" → LPAREN, RPAREN — parse expects expr inside parens, finds RPAREN, error
      expect(service.shouldRunStep("()", {})).toBe(false);
    });

    it('should return false for lone operator', () => {
      expect(service.shouldRunStep("NOT", {})).toBe(false);
    });

    it('should return false for incomplete function call (missing args)', () => {
      // contains( → expects args list or RPAREN, then fails somewhere
      expect(service.shouldRunStep("contains(", {})).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Real-world patterns
  // ──────────────────────────────────────────────────────────────────────────

  describe("real-world patterns", () => {
    it('should evaluate context mode qualification check', () => {
      expect(service.shouldRunStep('context.mode == "qualify"', { context: { mode: "qualify" } })).toBe(true);
    });

    it('should evaluate context mode mismatch', () => {
      expect(service.shouldRunStep('context.mode == "qualify"', { context: { mode: "closed" } })).toBe(false);
    });

    it('should evaluate contains with dot-path argument', () => {
      const state = { input: { message: "I need help with something" } };
      expect(service.shouldRunStep('contains(input.message, "help")', state)).toBe(true);
    });

    it('should compound AND with dot-path and not-empty check', () => {
      const state = { context: { step: "validate" }, input: { message: "hello" } };
      expect(service.shouldRunStep('context.step == "validate" AND input.message != ""', state)).toBe(true);
    });

    it('should compound AND — second condition fails', () => {
      const state = { context: { step: "validate" }, input: { message: "" } };
      expect(service.shouldRunStep('context.step == "validate" AND input.message != ""', state)).toBe(false);
    });

    it('should evaluate NOT with missing path', () => {
      // skip is not in state → undefined → falsy → NOT → true
      expect(service.shouldRunStep("NOT skip", {})).toBe(true);
    });

    it('should evaluate NOT with false value', () => {
      expect(service.shouldRunStep("NOT skip", { skip: false })).toBe(true);
    });

    it('should evaluate NOT with true value', () => {
      expect(service.shouldRunStep("NOT skip", { skip: true })).toBe(false);
    });

    it('should evaluate OR with dot paths (first matches)', () => {
      const state = { context: { mode: "closed" } };
      expect(service.shouldRunStep('context.mode == "closed" OR context.mode == "resolved"', state)).toBe(true);
    });

    it('should evaluate OR with dot paths (second matches)', () => {
      const state = { context: { mode: "resolved" } };
      expect(service.shouldRunStep('context.mode == "closed" OR context.mode == "resolved"', state)).toBe(true);
    });

    it('should evaluate OR with dot paths (neither matches)', () => {
      const state = { context: { mode: "open" } };
      expect(service.shouldRunStep('context.mode == "closed" OR context.mode == "resolved"', state)).toBe(false);
    });

    it('should evaluate a step guard with exists and NOT', () => {
      const state = { data: { value: 42 }, errors: [] };
      expect(service.shouldRunStep('exists(data.value) AND NOT exists(errors)', state)).toBe(true);
    });

    it('should evaluate a step guard — data missing', () => {
      const state = { errors: [] };
      expect(service.shouldRunStep('exists(data.value) AND NOT exists(errors)', state)).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Literal types
  // ──────────────────────────────────────────────────────────────────────────

  describe("literal types", () => {
    it('should treat "true" as boolean true', () => {
      expect(service.shouldRunStep("true", {})).toBe(true);
    });

    it('should treat "TRUE" as boolean true (uppercase keyword)', () => {
      expect(service.shouldRunStep("TRUE", {})).toBe(true);
    });

    it('should treat "false" as boolean false', () => {
      expect(service.shouldRunStep("false", {})).toBe(false);
    });

    it('should treat "null" as null literal', () => {
      expect(service.shouldRunStep("null", {})).toBe(false); // Boolean(null) === false
    });

    it('should compare null with ===', () => {
      // null === null → true
      expect(service.shouldRunStep("null == null", {})).toBe(true);
    });

    it('should parse integer number literals', () => {
      expect(service.shouldRunStep("a == 42", { a: 42 })).toBe(true);
    });

    it('should parse float number literals', () => {
      expect(service.shouldRunStep("a == 3.14", { a: 3.14 })).toBe(true);
    });

    it('should parse negative number literals', () => {
      expect(service.shouldRunStep("a == -7", { a: -7 })).toBe(true);
    });

    it('should parse negative float literals', () => {
      expect(service.shouldRunStep("a == -0.5", { a: -0.5 })).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. Edge cases
  // ──────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it('should handle extra whitespace between tokens', () => {
      expect(service.shouldRunStep("  a   ==   1   AND   b   ==   2  ", { a: 1, b: 2 })).toBe(true);
    });

    it('should handle tabs and newlines between tokens', () => {
      expect(service.shouldRunStep("a\t==\n1\rAND\tb\n==\r2", { a: 1, b: 2 })).toBe(true);
    });

    it('should handle unicode characters in strings', () => {
      expect(service.shouldRunStep('a == "café ñoño 🎉"', { a: "café ñoño 🎉" })).toBe(true);
    });

    it('should be case-insensitive for logical operators (lowercase)', () => {
      expect(service.shouldRunStep("a == 1 and b == 2", { a: 1, b: 2 })).toBe(true);
    });

    it('should be case-insensitive for logical operators (mixed case)', () => {
      expect(service.shouldRunStep("a == 1 And b == 2 Or c == 3", { a: 1, b: 99, c: 3 })).toBe(true);
    });

    it('should handle keyword literals in any case', () => {
      expect(service.shouldRunStep("True", {})).toBe(true);
      expect(service.shouldRunStep("FALSE", {})).toBe(false);
      expect(service.shouldRunStep("Null", {})).toBe(false);
    });

    it('should handle long condition strings', () => {
      const parts = [
        'a == 1',
        'b == 2',
        'c == 3',
        'd == 4',
        'e == 5',
      ];
      const condition = parts.join(' AND ');
      const state = { a: 1, b: 2, c: 3, d: 4, e: 5 };
      expect(service.shouldRunStep(condition, state)).toBe(true);
    });

    it('should short-circuit on AND (left false)', () => {
      // If left is false, right is never evaluated — but here right is also false,
      // so the result is false regardless. We're testing that it doesn't crash.
      expect(service.shouldRunStep("a == 99 AND b == xyz", { a: 1 })).toBe(false);
    });

    it('should handle escaped quotes in strings', () => {
      expect(service.shouldRunStep('a == "hello\\"world"', { a: 'hello"world' })).toBe(true);
    });

    it('should handle escaped single quotes in strings', () => {
      expect(service.shouldRunStep("a == 'hello\\'world'", { a: "hello'world" })).toBe(true);
    });

    it('should work with multiple different helpers in one expression', () => {
      const state = { name: "hello world", code: "ABC123" };
      expect(service.shouldRunStep('contains(name, "hello") AND regex("^ABC", code)', state)).toBe(true);
    });

    it('should work with a NOT on a function call result', () => {
      expect(service.shouldRunStep('NOT exists(missing)', {})).toBe(true);
    });

    it('should treat identifier names that shadow keywords as keywords', () => {
      // "and" as an identifier is consumed as AND operator, not a field name.
      // So "and == 1" would tokenize as: AND, EQ, NUMBER(1)
      // But AND is not a valid start of an expression → error → false
      expect(service.shouldRunStep("and == 1", { and: 1 })).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Regression tests (bugs found during development)
  // ──────────────────────────────────────────────────────────────────────────

  describe("regression tests", () => {
    it('should not crash on empty helper call (contains with no args)', () => {
      // contains() → valid syntax (0 args allowed), but values = [].
      // String(undefined ?? "") → "" → "" includes "" → true
      // Actually: args.map(a → evaluate) → [] → values = []
      // const [value, expected] = values → value = undefined, expected = undefined
      // String(undefined ?? "") → String("") → ""
      // "".includes("") → true
      // Boolean(true) → true
      expect(service.shouldRunStep("contains()", {})).toBe(true);
    });

    it('should return false when NOT is applied to a literal true', () => {
      expect(service.shouldRunStep("NOT true", {})).toBe(false);
    });

    it('should return true when NOT is applied to a literal false', () => {
      expect(service.shouldRunStep("NOT false", {})).toBe(true);
    });

    it('should handle complex nested expression with AND/OR/parens/NOT', () => {
      const state = { a: 1, b: 2, c: 3, d: 4 };
      // (a == 1 AND b == 2) OR (NOT (c == 99 AND d == 4))
      const condition = "(a == 1 AND b == 2) OR (NOT (c == 99 AND d == 4))";
      expect(service.shouldRunStep(condition, state)).toBe(true);
    });

    it('should handle a bare boolean keyword as the entire expression', () => {
      expect(service.shouldRunStep("true", {})).toBe(true);
      expect(service.shouldRunStep("false", {})).toBe(false);
    });
  });
});
