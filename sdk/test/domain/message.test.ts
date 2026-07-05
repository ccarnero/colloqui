import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "../../src/domain/errors.js";
import { normalizeMessage } from "../../src/domain/message.js";

test("requires from", () => {
  assert.throws(() => normalizeMessage({ text: "hi" }), ValidationError);
});

test("rejects non-object input", () => {
  assert.throws(() => normalizeMessage(null), ValidationError);
  assert.throws(() => normalizeMessage([]), ValidationError);
});

test("defaults type to text", () => {
  assert.equal(normalizeMessage({ from: "u" }).type, "text");
});

test("keeps text flat and rejects non-string text", () => {
  assert.equal(normalizeMessage({ from: "u", text: "hello" }).text, "hello");
  assert.throws(
    () => normalizeMessage({ from: "u", text: 5 }),
    ValidationError
  );
});

test("folds media and extra top-level keys into raw", () => {
  const body = normalizeMessage({
    from: "u",
    text: "hi",
    media: { mimeType: "image/png" },
    ticketId: 42,
  });
  assert.deepEqual(body.raw, {
    media: { mimeType: "image/png" },
    ticketId: 42,
  });
});

test("explicit raw wins over folded extras on collision", () => {
  const body = normalizeMessage({
    from: "u",
    ticketId: 1,
    raw: { ticketId: 99 },
  });
  assert.equal((body.raw as Record<string, unknown>).ticketId, 99);
});

test("omits server-derived fields when absent", () => {
  const body = normalizeMessage({ from: "u" });
  assert.equal("messageId" in body, false);
  assert.equal("timestamp" in body, false);
  assert.equal("raw" in body, false);
});

test("passes messageId and timestamp through as strings", () => {
  const body = normalizeMessage({ from: "u", messageId: "m1", timestamp: 123 });
  assert.equal(body.messageId, "m1");
  assert.equal(body.timestamp, "123");
});
