import assert from "node:assert/strict";
import { test } from "node:test";
import { extractManifestResources } from "./extract-manifest-resources.js";

test("extractManifestResources() flattens every declared section into kind/name/external rows", () => {
  const result = extractManifestResources({
    metadata: { name: "support-bot" },
    spec: {
      channels: [{ name: "http-in", type: "http" }],
      connectors: [{ name: "pokeapi", external: true }],
      mcpServers: [{ name: "mcp-docs" }],
      skills: [{ name: "summarize" }],
      agents: [{ name: "triage" }],
      services: [{ name: "hosted-api" }],
      systemVariables: [{ name: "chat-id" }],
      workflows: [{ name: "fanout" }],
      knowledgeBases: [{ name: "handbook" }],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.value, [
    { kind: "channel", name: "http-in", external: false },
    { kind: "connector", name: "pokeapi", external: true },
    { kind: "mcpServer", name: "mcp-docs", external: false },
    { kind: "skill", name: "summarize", external: false },
    { kind: "agent", name: "triage", external: false },
    { kind: "service", name: "hosted-api", external: false },
    { kind: "systemVariable", name: "chat-id", external: false },
    { kind: "workflow", name: "fanout", external: false },
    { kind: "knowledgeBase", name: "handbook", external: false },
  ]);
});

test("extractManifestResources() returns an empty list for a manifest with no spec (never throws)", () => {
  const result = extractManifestResources({ metadata: { name: "empty" } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, []);
  }
});

test("extractManifestResources() skips absent sections instead of inventing rows", () => {
  const result = extractManifestResources({
    spec: { channels: [{ name: "http-in" }] },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [
      { kind: "channel", name: "http-in", external: false },
    ]);
  }
});

test("extractManifestResources() errors with a precise path for a non-array section", () => {
  const result = extractManifestResources({ spec: { channels: {} } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /spec\.channels.*array/);
  }
});

test("extractManifestResources() errors with a precise path for an entry missing 'name'", () => {
  const result = extractManifestResources({
    spec: { agents: [{ name: "ok" }, { type: "no-name" }] },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /spec\.agents\[1\]\.name/);
  }
});

test("extractManifestResources() errors for a non-boolean 'external' flag (it decides what gets deleted)", () => {
  const result = extractManifestResources({
    spec: { connectors: [{ name: "pokeapi", external: "yes" }] },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /spec\.connectors\[0\]\.external/);
  }
});

test("extractManifestResources() errors for a non-object 'spec'", () => {
  const result = extractManifestResources({ spec: "nope" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /'spec' must be an object/);
  }
});
