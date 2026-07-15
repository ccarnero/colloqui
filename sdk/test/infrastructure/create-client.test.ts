import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../src/infrastructure/create-client.js";

/**
 * Lock K1 (see cowork/DOC-VS-CODE-AUDIT.md): SDK namespace census.
 *
 * `createClient()` is documented (DOCS/architecture/overview.md,
 * sdk/README.md) as exposing exactly these 21 resource namespaces, on top of
 * `send`/`sendText`. Source of truth:
 * src/infrastructure/create-client.ts (the `ports`/`return` block).
 *
 * This test intentionally hardcodes the expected list so that adding,
 * removing, or renaming a namespace fails this test until the docs are
 * updated to match — the list here IS the doc contract.
 *
 * T08 (manual-loops/declarative-provisioning.md) added `manifests` and
 * `secrets`.
 */
const EXPECTED_NAMESPACES = [
  "workflows",
  "agents",
  "runtime",
  "channels",
  "webhooks",
  "knowledgeBases",
  "skills",
  "systemVariables",
  "mcpServers",
  "connectors",
  "registry",
  "authAdmin",
  "tenants",
  "audit",
  "jobs",
  "memories",
  "structuredKb",
  "configFiles",
  "dashboard",
  "manifests",
  "secrets",
] as const;

function fakeFetch() {
  return async () => {
    throw new Error("unexpected network call in a namespace-census test");
  };
}

test("createClient() exposes exactly the 21 documented resource namespaces", () => {
  const client = createClient({
    tenant: "acme",
    email: "e@x.com",
    password: "p",
    fetch: fakeFetch(),
  });

  for (const namespace of EXPECTED_NAMESPACES) {
    assert.ok(
      namespace in client,
      `expected client to expose namespace "${namespace}"`
    );
  }

  const nonNamespaceKeys = ["send", "sendText"];
  const actualNamespaces = Object.keys(client).filter(
    (key) => !nonNamespaceKeys.includes(key)
  );

  assert.deepEqual(
    actualNamespaces.sort(),
    [...EXPECTED_NAMESPACES].sort(),
    "client namespace surface drifted from the documented 21-namespace list " +
      "— update DOCS/architecture/overview.md and sdk/README.md alongside " +
      "this test's EXPECTED_NAMESPACES"
  );
  assert.equal(EXPECTED_NAMESPACES.length, 21);
});
