import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { createHttpListResourceClient } from "../../../src/modules/plan/infrastructure/create-http-list-resource-client";

interface FakeItem {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

describe("createHttpListResourceClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards the tenant header on every request", async () => {
    let receivedHeaders: HeadersInit | undefined;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      receivedHeaders = init?.headers;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "channel",
      baseUrl: "http://channel-service.local",
      listPath: "/channels/accounts",
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item) => ({ kind: item.kind }),
    });

    await client.findByName("tenant-a", "http-in");
    expect((receivedHeaders as Record<string, string>)[TENANT_HEADER]).toBe(
      "tenant-a"
    );
  });

  it("returns ok(null) when no item matches the name", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify([]), { status: 200 })
    ) as unknown as typeof fetch;

    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "channel",
      baseUrl: "http://channel-service.local",
      listPath: "/channels/accounts",
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item) => ({ kind: item.kind }),
    });

    const result = await client.findByName("tenant-a", "missing");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("returns the projected fields when a matching item is found", async () => {
    const items: FakeItem[] = [{ id: "id-1", name: "http-in", kind: "http" }];
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify(items), { status: 200 })
    ) as unknown as typeof fetch;

    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "channel",
      baseUrl: "http://channel-service.local",
      listPath: "/channels/accounts",
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item) => ({ kind: item.kind }),
    });

    const result = await client.findByName("tenant-a", "http-in");
    expect(result).toEqual({
      ok: true,
      value: { externalId: "id-1", fields: { kind: "http" } },
    });
  });

  it("returns a typed downstream_error on a non-2xx response, never throws", async () => {
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 503 })
    ) as unknown as typeof fetch;

    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "channel",
      baseUrl: "http://channel-service.local",
      listPath: "/channels/accounts",
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item) => ({ kind: item.kind }),
    });

    const result = await client.findByName("tenant-a", "http-in");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.message).toContain("503");
    }
  });

  it("returns a typed downstream_error on a network failure, never throws", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "channel",
      baseUrl: "http://channel-service.local",
      listPath: "/channels/accounts",
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item) => ({ kind: item.kind }),
    });

    const result = await client.findByName("tenant-a", "http-in");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("ECONNREFUSED");
    }
  });

  it("unwraps an enveloped list response (e.g. agent-admin-service's { agents, total })", async () => {
    const body = { agents: [{ id: "id-1", name: "agent-1", kind: "x" }] };
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify(body), { status: 200 })
    ) as unknown as typeof fetch;

    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "agent",
      baseUrl: "http://agent-admin-service.local",
      listPath: "/admin/agents",
      unwrapList: (raw) => (raw as { agents: FakeItem[] }).agents,
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item) => ({ kind: item.kind }),
    });

    const result = await client.findByName("tenant-a", "agent-1");
    expect(result).toEqual({
      ok: true,
      value: { externalId: "id-1", fields: { kind: "x" } },
    });
  });

  // T04 (manual-loops/provisioning-manifest-gaps-2.md, gap 4) — forwards
  // findByName's optional third argument (the manifest's own desired
  // resource) through to getFields, the same "declared" idiom
  // serviceComparable/registry-services-client.ts established for T05.
  it("forwards the declaredResource argument to getFields", async () => {
    const items: FakeItem[] = [{ id: "id-1", name: "http-in", kind: "http" }];
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify(items), { status: 200 })
    ) as unknown as typeof fetch;

    let receivedDeclared: unknown;
    const client = createHttpListResourceClient<FakeItem>({
      resourceKind: "channel",
      baseUrl: "http://channel-service.local",
      listPath: "/channels/accounts",
      getName: (item) => item.name,
      getExternalId: (item) => item.id,
      getFields: (item, declaredResource) => {
        receivedDeclared = declaredResource;
        return { kind: item.kind };
      },
    });

    const declared = { name: "http-in", marker: "manifest-resource" };
    await client.findByName("tenant-a", "http-in", declared);
    expect(receivedDeclared).toBe(declared);
  });
});
