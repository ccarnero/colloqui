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
});
