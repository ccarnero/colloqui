import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Connector } from "@yoizen/shared";
import { createConnectorsWriter } from "../../../src/modules/apply/infrastructure/connectors-writer";

const BASE_URL = "http://connector-admin.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createConnectorsWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: refuses a connector with a secretRef — connector broker wiring is a T05 follow-up, never fabricates auth material", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error(
        "must never call the network for a secretRef'd connector"
      );
    }) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      secretRef: "hubspot-key",
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
    }
  });

  it("create: fails loud with a typed error when config.baseUrl is missing", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network without a baseUrl");
    }) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = { name: "no-url", type: "http" };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_required_field");
    }
  });

  it("create: config.baseUrl present -> POST /connectors", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "conn-1" }, 201)
    ) as unknown as typeof fetch;

    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = {
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
    };

    const result = await writer.create("tenant-a", connector);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("conn-1");
    }
  });

  it("update: existence-only kind — never exercised, safe no-op", async () => {
    const writer = createConnectorsWriter(BASE_URL);
    const connector: Connector = { name: "hubspot", type: "http" };
    const result = await writer.update("tenant-a", "conn-1", connector, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("conn-1");
    }
  });
});
