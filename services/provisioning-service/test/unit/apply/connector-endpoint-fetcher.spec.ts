import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { createConnectorEndpointFetcher } from "../../../src/modules/apply/infrastructure/connector-endpoint-fetcher";

const BASE_URL = "http://connector-admin.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// manual-loops/provisioning-manifest-gaps-4.md T03 — the live
// `GET /connectors/:id` closure `resolve-service-env-refs.ts`'s
// `fetchConnectorEndpoints` uses in production.
describe("createConnectorEndpointFetcher", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the connector's live endpoints on a 200 response", async () => {
    let capturedUrl: string | undefined;
    let capturedTenantHeader: string | undefined;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedTenantHeader = (init.headers as Record<string, string>)[
        "x-yoizen-tenant"
      ];
      return json({
        id: "conn-1",
        endpoints: [
          { id: "ep-1", method: "GET", path: "/contacts" },
          { id: "ep-2", method: "POST", path: "/tickets" },
        ],
      });
    }) as unknown as typeof fetch;

    const fetchConnectorEndpoints = createConnectorEndpointFetcher(BASE_URL);
    const result = await fetchConnectorEndpoints("tenant-a", "conn-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endpoints).toEqual([
        { id: "ep-1", method: "GET", path: "/contacts" },
        { id: "ep-2", method: "POST", path: "/tickets" },
      ]);
    }
    expect(capturedUrl).toBe(`${BASE_URL}/connectors/conn-1`);
    expect(capturedTenantHeader).toBe("tenant-a");
  });

  it("defaults to an empty endpoints array when the response omits .endpoints", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "conn-1" })
    ) as unknown as typeof fetch;

    const fetchConnectorEndpoints = createConnectorEndpointFetcher(BASE_URL);
    const result = await fetchConnectorEndpoints("tenant-a", "conn-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endpoints).toEqual([]);
    }
  });

  it("fails loud with a typed downstream_error on a network failure — never throws, never silently unresolved", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const fetchConnectorEndpoints = createConnectorEndpointFetcher(BASE_URL);
    const result = await fetchConnectorEndpoints("tenant-a", "conn-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.message).toContain("ECONNREFUSED");
    }
  });

  it("fails loud with a typed downstream_error on a non-2xx response", async () => {
    globalThis.fetch = mock(async () =>
      json({ message: "not found" }, 404)
    ) as unknown as typeof fetch;

    const fetchConnectorEndpoints = createConnectorEndpointFetcher(BASE_URL);
    const result = await fetchConnectorEndpoints("tenant-a", "conn-missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.message).toContain("404");
    }
  });

  it("fails loud with a typed downstream_error on a malformed (non-JSON) body", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
    ) as unknown as typeof fetch;

    const fetchConnectorEndpoints = createConnectorEndpointFetcher(BASE_URL);
    const result = await fetchConnectorEndpoints("tenant-a", "conn-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });
});
