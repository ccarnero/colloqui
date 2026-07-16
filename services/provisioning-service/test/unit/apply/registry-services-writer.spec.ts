import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { HostedService } from "@yoizen/shared";
import { createRegistryServicesWriter } from "../../../src/modules/apply/infrastructure/registry-services-writer";

const BASE_URL = "http://registry-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createRegistryServicesWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: refuses a buildRef-declared service (registry-service has no build resolution path)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network for a buildRef service");
    }) as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      buildRef: "git:main:build.sh",
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported_kind_shape");
    }
  });

  it("create: refuses a service with non-empty env (every env var needs a secretRef the T05 broker hasn't landed)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("must never call the network for env with secretRef");
    }) as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      env: [{ name: "API_KEY", secretRef: "scorer-key" }],
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("secret_not_resolvable");
    }
  });

  it("create: image-referenced service with no env -> POST /services", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "svc-1" }, 201)
    ) as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("svc-1");
    }
  });

  it("update: PATCH /services/:id when env stays empty", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "svc-1" })
    ) as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:2.0",
    };

    const result = await writer.update("tenant-a", "svc-1", service, [
      { field: "envNames" },
    ]);
    expect(result.ok).toBe(true);
  });

  // ---------------------------------------------------------------------
  // T05 (manual-loops/provisioning-manifest-gaps.md, gap 5) — scaling
  // fields passthrough + routes reconciliation + collision check.
  // ---------------------------------------------------------------------

  function requestsOf(fetchMock: ReturnType<typeof mock>): {
    method: string;
    url: string;
    body: unknown;
  }[] {
    return fetchMock.mock.calls.map(
      ([url, init]: [string, RequestInit | undefined]) => ({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      })
    );
  }

  it("create: sends ONLY the scaling fields the manifest declares (never invents a value for an omitted field)", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json({ id: "svc-1" }, 201);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      port: 8080,
      maxScale: 5,
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(true);

    const [createRequest] = requestsOf(fetchMock);
    expect(createRequest.body).toMatchObject({ port: 8080, maxScale: 5 });
    expect(createRequest.body).not.toHaveProperty("minScale");
    expect(createRequest.body).not.toHaveProperty("concurrencyTarget");
  });

  it("create: declares a route with no live collision -> POST /services/:id/routes", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json({ id: "svc-1" }, 201);
      }
      if (input === `${BASE_URL}/routes`) {
        return json([]); // no live routes anywhere -> no collision possible
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json([]); // no existing routes for this service yet
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/priority-scorer" }],
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(true);

    const requests = requestsOf(fetchMock);
    const createRouteRequest = requests.find(
      (r) =>
        r.method === "POST" && r.url === `${BASE_URL}/services/svc-1/routes`
    );
    expect(createRouteRequest).toBeDefined();
    expect(createRouteRequest?.body).toMatchObject({
      pathPrefix: "/priority-scorer",
    });
  });

  it("create: a route pathPrefix owned by a DIFFERENT service/tenant fails loud (route_collision)", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json({ id: "svc-1" }, 201);
      }
      if (input === `${BASE_URL}/routes`) {
        return json([
          {
            pathPrefix: "/priority-scorer",
            serviceName: "some-other-service",
            tenantId: "tenant-b",
          },
        ]);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/priority-scorer" }],
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("route_collision");
      expect(result.error.message).toContain("some-other-service");
      expect(result.error.message).toContain("tenant-b");
      expect(result.error.message).toContain("/priority-scorer");
    }

    // The per-service routes list/create must never be attempted once a
    // collision is detected.
    const requests = requestsOf(fetchMock);
    expect(
      requests.some((r) => r.url === `${BASE_URL}/services/svc-1/routes`)
    ).toBe(false);
  });

  it("create: a route pathPrefix owned by the SAME service/tenant is not a collision (normal reconcile)", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services`) {
        return json({ id: "svc-1" }, 201);
      }
      if (input === `${BASE_URL}/routes`) {
        return json([
          {
            pathPrefix: "/priority-scorer",
            serviceName: "priority-scorer",
            tenantId: "tenant-a",
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json([]);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/priority-scorer" }],
    };

    const result = await writer.create("tenant-a", service);
    expect(result.ok).toBe(true);
  });

  it("update: an unchanged live route is a no-op (never POSTs/DELETEs)", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services/svc-1`) {
        return json({ id: "svc-1" });
      }
      if (input === `${BASE_URL}/routes`) {
        return json([
          {
            pathPrefix: "/priority-scorer",
            serviceName: "priority-scorer",
            tenantId: "tenant-a",
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json([
          {
            id: "route-1",
            pathPrefix: "/priority-scorer",
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            isPublic: false,
            stripPrefix: true,
          },
        ]);
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/priority-scorer" }],
    };

    const result = await writer.update("tenant-a", "svc-1", service, []);
    expect(result.ok).toBe(true);

    const requests = requestsOf(fetchMock);
    expect(
      requests.some(
        (r) =>
          r.url === `${BASE_URL}/services/svc-1/routes` &&
          (r.method === "POST" || r.method === "DELETE")
      )
    ).toBe(false);
  });

  it("update: a changed live route is removed then recreated (no update verb exists server-side)", async () => {
    const fetchMock = mock(async (input: string) => {
      if (input === `${BASE_URL}/services/svc-1`) {
        return json({ id: "svc-1" });
      }
      if (input === `${BASE_URL}/routes`) {
        return json([
          {
            pathPrefix: "/priority-scorer",
            serviceName: "priority-scorer",
            tenantId: "tenant-a",
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes`) {
        return json([
          {
            id: "route-1",
            pathPrefix: "/priority-scorer",
            methods: ["GET"],
            isPublic: false,
            stripPrefix: true,
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes/route-1`) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      // Declares every method (differs from the live GET-only route) ->
      // must be removed then recreated, not PATCHed.
      routes: [{ pathPrefix: "/priority-scorer" }],
    };

    const result = await writer.update("tenant-a", "svc-1", service, []);
    expect(result.ok).toBe(true);

    const requests = requestsOf(fetchMock);
    const deleteRequest = requests.find(
      (r) =>
        r.method === "DELETE" &&
        r.url === `${BASE_URL}/services/svc-1/routes/route-1`
    );
    const createRequest = requests.find(
      (r) =>
        r.method === "POST" && r.url === `${BASE_URL}/services/svc-1/routes`
    );
    expect(deleteRequest).toBeDefined();
    expect(createRequest).toBeDefined();
    // Remove must happen BEFORE recreate.
    expect(requests.indexOf(deleteRequest!)).toBeLessThan(
      requests.indexOf(createRequest!)
    );
  });

  it("update: remove-then-recreate where DELETE succeeds but the recreate POST fails -> typed downstream_error (never route_collision, never swallowed)", async () => {
    const fetchMock = mock(async (input: string, init?: RequestInit) => {
      if (input === `${BASE_URL}/services/svc-1`) {
        return json({ id: "svc-1" });
      }
      if (input === `${BASE_URL}/routes`) {
        return json([
          {
            pathPrefix: "/priority-scorer",
            serviceName: "priority-scorer",
            tenantId: "tenant-a",
          },
        ]);
      }
      if (
        input === `${BASE_URL}/services/svc-1/routes` &&
        (init?.method ?? "GET") === "GET"
      ) {
        return json([
          {
            id: "route-1",
            pathPrefix: "/priority-scorer",
            methods: ["GET"], // differs -> triggers remove-then-recreate
            isPublic: false,
            stripPrefix: true,
          },
        ]);
      }
      if (input === `${BASE_URL}/services/svc-1/routes/route-1`) {
        return new Response(null, { status: 204 }); // DELETE succeeds
      }
      if (
        input === `${BASE_URL}/services/svc-1/routes` &&
        init?.method === "POST"
      ) {
        return json({ message: "boom" }, 500); // recreate POST fails
      }
      throw new Error(`unexpected URL: ${input}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const writer = createRegistryServicesWriter(BASE_URL);
    const service: HostedService = {
      name: "priority-scorer",
      image: "registry.example.com/priority-scorer:1.0",
      routes: [{ pathPrefix: "/priority-scorer" }],
    };

    const result = await writer.update("tenant-a", "svc-1", service, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.resourceName).toBe("priority-scorer");
    }

    // The DELETE did fire (transient window entered); the failure is surfaced,
    // not swallowed.
    const requests = requestsOf(fetchMock);
    expect(
      requests.some(
        (r) =>
          r.method === "DELETE" &&
          r.url === `${BASE_URL}/services/svc-1/routes/route-1`
      )
    ).toBe(true);
  });
});
