import assert from "node:assert/strict";
import { test } from "node:test";
import { formatVerdictTable } from "./format-verdict-table.js";

test("formatVerdictTable() renders a stable, greppable table with the literal verdict words", () => {
  const table = formatVerdictTable([
    { kind: "channel", name: "http-in", verdict: "create" },
    { kind: "agent", name: "bot", verdict: "noop" },
    { kind: "workflow", name: "wf", verdict: "update" },
  ]);

  assert.match(table, /create/);
  assert.match(table, /update/);
  assert.match(table, /noop/);
  assert.match(table, /^KIND\tNAME\tVERDICT$/m);
  assert.match(table, /^channel\thttp-in\tcreate$/m);
});

test("formatVerdictTable() renders just the header for an empty resource list", () => {
  const table = formatVerdictTable([]);
  assert.equal(table, "KIND\tNAME\tVERDICT");
});
