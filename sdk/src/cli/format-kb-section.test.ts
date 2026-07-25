import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatKbApplySection,
  formatKbPlanSection,
} from "./format-kb-section.js";

test("formatKbPlanSection() renders one line per kb plus per-document actions", () => {
  const lines = formatKbPlanSection([
    {
      kbName: "support-faq",
      external: false,
      documents: [
        { documentName: "faq.md", action: "reembed", chunkEstimate: 12 },
        { documentName: "policies.md", action: "skip" },
      ],
      reembedCount: 1,
      chunkEstimateTotal: 12,
      summary: "will re-embed 1 document (~12 chunks)",
    },
  ]);
  assert.deepEqual(lines, [
    "",
    "KNOWLEDGE BASES:",
    "  support-faq: will re-embed 1 document (~12 chunks)",
    "    faq.md: reembed (~12 chunks)",
    "    policies.md: skip",
  ]);
});

test("formatKbPlanSection() returns no lines for an empty or absent kb list", () => {
  assert.deepEqual(formatKbPlanSection([]), []);
  assert.deepEqual(formatKbPlanSection(undefined), []);
});

test("formatKbApplySection() renders one kbName/documentName line per outcome", () => {
  const lines = formatKbApplySection([
    { kbName: "support-faq", documentName: "faq.md", action: "reembed" },
    { kbName: "support-faq", documentName: "policies.md", action: "skip" },
  ]);
  assert.deepEqual(lines, [
    "",
    "KNOWLEDGE BASES:",
    "  support-faq/faq.md: reembed",
    "  support-faq/policies.md: skip",
  ]);
});

test("formatKbApplySection() returns no lines for an empty or absent outcome list", () => {
  assert.deepEqual(formatKbApplySection([]), []);
  assert.deepEqual(formatKbApplySection(undefined), []);
});
