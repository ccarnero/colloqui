import assert from "node:assert/strict";
import { test } from "node:test";
import type { ManifestUndeployResult } from "../resources/manifests/index.js";
import { formatUndeployReport } from "./format-undeploy-report.js";

const fullReport: ManifestUndeployResult = {
  manifestName: "http-fanout-telegram",
  resources: [
    { kind: "workflow", name: "fanout", action: "deleted", externalId: "wf-1" },
    { kind: "knowledgeBase", name: "handbook", action: "not_found" },
    { kind: "connector", name: "pokeapi", action: "skipped_external" },
    { kind: "skill", name: "summarize", action: "skipped_no_delete_api" },
  ],
  secrets: [
    {
      name: "telegram-bot-token",
      scope: { kind: "channel", owner: "http-in" },
      action: "deleted",
    },
  ],
  deletedCount: 1,
  notFoundCount: 1,
  skippedCount: 2,
  checksumRowsDeleted: 3,
  manifestRecordDeleted: true,
  durationMs: 42,
};

test("formatUndeployReport() prints a tab-separated KIND/NAME/ACTION table with every outcome verbatim", () => {
  const lines = formatUndeployReport(fullReport);
  assert.equal(lines[0], "KIND\tNAME\tACTION");
  assert.equal(lines[1], "workflow\tfanout\tdeleted");
  assert.equal(lines[2], "knowledgeBase\thandbook\tnot_found");
  assert.equal(lines[3], "connector\tpokeapi\tskipped_external");
  assert.equal(lines[4], "skill\tsummarize\tskipped_no_delete_api");
});

test("formatUndeployReport() prints the secret bindings with their scope and action", () => {
  const output = formatUndeployReport(fullReport).join("\n");
  assert.match(output, /SECRETS:/);
  assert.match(output, /telegram-bot-token \(channel:http-in\): deleted/);
});

test("formatUndeployReport() ends with the counts + duration summary", () => {
  const output = formatUndeployReport(fullReport).join("\n");
  assert.match(
    output,
    /deleted=1 notFound=1 skipped=2 checksumRows=3 manifestRecordDeleted=true durationMs=42/
  );
});

test("formatUndeployReport() omits the SECRETS section when the manifest declared none", () => {
  const output = formatUndeployReport({
    ...fullReport,
    secrets: [],
  }).join("\n");
  assert.doesNotMatch(output, /SECRETS:/);
});

test("formatUndeployReport() reports a kept manifest record (partial-style report) without lying about it", () => {
  const output = formatUndeployReport({
    ...fullReport,
    manifestRecordDeleted: false,
  }).join("\n");
  assert.match(output, /manifestRecordDeleted=false/);
});

test("formatUndeployReport() NEVER prints 'undefined' — a drifted/partial server body degrades to '(unknown)' (regression pin: ReconcileKbOutcome drift, commit d6fca63f)", () => {
  const drifted = {
    manifestName: "drifted",
    resources: [{ name: "orphan" }, undefined],
    secrets: [{ name: "token" }],
  } as unknown as ManifestUndeployResult;

  const output = formatUndeployReport(drifted).join("\n");
  assert.doesNotMatch(output, /undefined/);
  assert.match(output, /\(unknown\)/);
  assert.match(output, /orphan/);
});

test("formatUndeployReport() never prints 'undefined' for a body missing resources/secrets entirely", () => {
  const empty = { manifestName: "empty" } as unknown as ManifestUndeployResult;
  const output = formatUndeployReport(empty).join("\n");
  assert.doesNotMatch(output, /undefined/);
});
