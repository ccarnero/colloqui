import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "../../src/domain/errors.js";
import { validateSender } from "../../src/domain/sender.js";

test("validateSender trims and returns a valid sender", () => {
  assert.equal(validateSender("  user@x.com  "), "user@x.com");
});

test("validateSender rejects empty string", () => {
  assert.throws(() => validateSender(""), ValidationError);
});

test("validateSender rejects whitespace-only", () => {
  assert.throws(() => validateSender("   "), ValidationError);
});

test("validateSender rejects non-string values", () => {
  assert.throws(() => validateSender(42), ValidationError);
  assert.throws(() => validateSender(undefined), ValidationError);
  assert.throws(() => validateSender(null), ValidationError);
});
