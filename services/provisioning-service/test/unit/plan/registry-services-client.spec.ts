import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { HostedService } from "@yoizen/shared";
import { createRegistryServicesClient } from "../../../src/modules/plan/infrastructure/registry-services-client";

const BASE_URL = "http://registry-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createRegistryServicesClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("findByName: no live service -> null, never fetches routes", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json([]);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createRegistryServicesClient(BASE_URL);
    const result = await client.findByName("tenant-a", "priority-scorer");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("findByName: matched service fetches live routes and projects them", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json([
          {
            id: "svc-1",
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
            envVars: {},
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json([
          {
            pathPrefix: "/priority-scorer",
            methods: ["GET"],
            isPublic: false,
            stripPrefix: true,
          },
        ]);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createRegistryServicesClient(BASE_URL);
    const result = await client.findByName("tenant-a", "priority-scorer");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.externalId).toBe("svc-1");
      expect(result.value?.fields).toMatchObject({
        routes: [
          {
            pathPrefix: "/priority-scorer",
            methods: ["GET"],
            isPublic: false,
            stripPrefix: true,
          },
        ],
      });
    }
  });

  it("findByName: scaling field is compared ONLY when the declared manifest resource declares it", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json([
          {
            id: "svc-1",
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
            envVars: {},
            port: 9090,
            minScale: 2,
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json([]);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createRegistryServicesClient(BASE_URL);

    // The manifest did NOT declare `port`/`minScale` — neither key may appear
    // in the live projection, even though the live service HAS real values
    // for both (server-side defaults applied at creation, decision 6).
    const declaredNoScaling: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
    };
    const resultA = await client.findByName(
      "tenant-a",
      "priority-scorer",
      declaredNoScaling
    );
    expect(resultA.ok).toBe(true);
    if (resultA.ok) {
      expect(resultA.value?.fields).not.toHaveProperty("port");
      expect(resultA.value?.fields).not.toHaveProperty("minScale");
    }

    // The manifest DOES declare `port` — now it must be compared against the
    // real live value.
    const declaredWithPort: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      port: 9090,
    };
    const resultB = await client.findByName(
      "tenant-a",
      "priority-scorer",
      declaredWithPort
    );
    expect(resultB.ok).toBe(true);
    if (resultB.ok) {
      expect(resultB.value?.fields).toMatchObject({ port: 9090 });
      expect(resultB.value?.fields).not.toHaveProperty("minScale");
    }
  });

  it("findByName: surfaces a downstream error from the routes fetch, never throws", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json([
          {
            id: "svc-1",
            name: "priority-scorer",
            image: "registry.example.com/priority-scorer:1.0",
            envVars: {},
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json({ message: "boom" }, 503);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createRegistryServicesClient(BASE_URL);
    const result = await client.findByName("tenant-a", "priority-scorer");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.resourceName).toBe("priority-scorer");
    }
  });
});
