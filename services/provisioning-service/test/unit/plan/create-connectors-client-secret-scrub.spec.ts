import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createConnectorsClient } from "../../../src/modules/plan/infrastructure/connectors-client";

// SECURITY regression (SPEC hard rule): the connector client must NEVER
// surface connector-admin's `authConfig` credential material into a plan.
// This test feeds a realistic connector-admin response whose adapter carries
// plaintext credentials and asserts none of them appear in the client's
// projected `fields`.

const SECRET_TOKENS = [
  "sk-super-secret-api-key",
  "bearer-9f8e7d6c",
  "hunter2-basic-password",
];

describe("createConnectorsClient — credential scrub", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("never projects authConfig secret values into the resolved fields", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: "conn-1",
              name: "hubspot",
              context: "external",
              baseUrl: "https://hubspot.example.com",
              authType: "apiKey",
              // The credential store — MUST NOT surface anywhere.
              authConfig: {
                apiKey: SECRET_TOKENS[0],
                bearerToken: SECRET_TOKENS[1],
                basicUsername: "svc",
                basicPassword: SECRET_TOKENS[2],
              },
            },
          ]),
          { status: 200 }
        )
    ) as unknown as typeof fetch;

    const client = createConnectorsClient("http://connector-admin.local");
    const result = await client.findByName("tenant-a", "hubspot");

    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      const serialized = JSON.stringify(result.value.fields);
      for (const token of SECRET_TOKENS) {
        expect(serialized).not.toContain(token);
      }
      // T02 (manual-loops/provisioning-manifest-gaps.md, gap 2): the
      // connector projection is no longer existence-only — `endpoints` is
      // now faithfully comparable and diffed. This adapter declares none,
      // so the projection is `{ endpoints: [] }`; `authConfig`/its secret
      // values still never appear anywhere in the projection.
      expect(result.value.fields).toEqual({ endpoints: [] });
      expect(result.value.externalId).toBe("conn-1");
    }
  });

  it("never projects endpoint response fields beyond label/method/path (no id/adapterId/createdAt/cache leakage of unrelated data)", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: "conn-1",
              name: "hubspot",
              context: "external",
              baseUrl: "https://hubspot.example.com",
              authType: "apiKey",
              authConfig: { apiKey: SECRET_TOKENS[0] },
              endpoints: [
                {
                  id: "ep-1",
                  adapterId: "conn-1",
                  label: "list-contacts",
                  method: "get",
                  path: "/contacts",
                  cache: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ]),
          { status: 200 }
        )
    ) as unknown as typeof fetch;

    const client = createConnectorsClient("http://connector-admin.local");
    const result = await client.findByName("tenant-a", "hubspot");

    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      const serialized = JSON.stringify(result.value.fields);
      expect(serialized).not.toContain(SECRET_TOKENS[0]);
      expect(result.value.fields).toEqual({
        endpoints: [
          { label: "list-contacts", method: "GET", path: "/contacts" },
        ],
      });
    }
  });
});
