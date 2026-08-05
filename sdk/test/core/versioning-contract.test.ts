import assert from "node:assert/strict";
import { test } from "node:test";
import { createTransport } from "../../src/core/transport.js";
import { resolveConfig } from "../../src/infrastructure/config.js";

/**
 * Lock K3 (see DOCS/archive/audits/DOC-VS-CODE-AUDIT.md): API versioning contract.
 *
 * Evidence: src/infrastructure/config.ts:24-30,104 (default `apiVersion` is
 * `"v1"`) and src/core/transport.ts:17-31,123-124 (`versionPrefix()` maps
 * `"v1"` -> `/api/v1`, anything else -> `/api`). This test pins the
 * end-to-end contract: a default-config client talks to `/api/v1/...`, and
 * an explicit `apiVersion: null` talks to the deprecated `/api/...` alias.
 *
 * History: `resolveConfig()` originally merged `apiVersion` with
 * `userConfig.apiVersion ?? "v1"`, silently coercing an explicit `null` back
 * to `"v1"` so the deprecated unversioned alias was unreachable through
 * `createClient()`. Fixed 2026-07-07 to only default when the key is
 * `undefined`; the second test below pins the fixed behavior.
 */
const FULL_ENV = {
  YOIZEN_TENANT: "acme",
  YOIZEN_EMAIL: "e@x.com",
  YOIZEN_PASSWORD: "p",
};

test("default resolved config produces /api/v1/... paths", async () => {
  const config = resolveConfig({}, FULL_ENV);
  assert.equal(config.apiVersion, "v1");

  let capturedUrl = "";
  const fetchImpl = async (url: string) => {
    capturedUrl = url;
    return {
      status: 200,
      ok: true,
      async text() {
        return "{}";
      },
    } as any;
  };

  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: config.tenant,
    apiVersion: config.apiVersion,
  });

  await transport.request({ path: "/workflows", auth: false });
  assert.equal(capturedUrl, "http://x/api/v1/workflows");
});

test("resolveConfig() preserves an explicit apiVersion: null (deprecated /api alias)", () => {
  const config = resolveConfig({ apiVersion: null }, FULL_ENV);
  assert.equal(
    config.apiVersion,
    null,
    "an explicit apiVersion: null must survive the config merge so the " +
      "deprecated unversioned /api alias stays reachable via createClient()"
  );
});

test("createTransport() with an explicit apiVersion: null (bypassing resolveConfig) produces /api/... paths", async () => {
  let capturedUrl = "";
  const fetchImpl = async (url: string) => {
    capturedUrl = url;
    return {
      status: 200,
      ok: true,
      async text() {
        return "{}";
      },
    } as any;
  };

  const transport = createTransport({
    fetchImpl,
    baseUrl: "http://x",
    tenant: "acme",
    apiVersion: null,
  });

  await transport.request({ path: "/workflows", auth: false });
  assert.equal(capturedUrl, "http://x/api/workflows");
});
