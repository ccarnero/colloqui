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
      // Existence-only projection — no field values at all.
      expect(result.value.fields).toEqual({});
      expect(result.value.externalId).toBe("conn-1");
    }
  });
});
