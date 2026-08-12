import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import type { IPlatformResourceClient } from "../../../src/modules/plan/domain/platform-resource-client.interface";
import {
  createHttpDeleteById,
  createHttpResourceDeleter,
} from "../../../src/modules/undeploy/infrastructure/create-http-resource-deleter";

const foundClient: IPlatformResourceClient = {
  async findByName() {
    return { ok: true, value: { externalId: "ext-1", fields: {} } };
  },
};

const missingClient: IPlatformResourceClient = {
  async findByName() {
    return { ok: true, value: null };
  },
};

const brokenClient: IPlatformResourceClient = {
  async findByName() {
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: "support-agent",
        message: "HTTP 503 from agent-admin",
      },
    };
  },
};

function deleter(readClient: IPlatformResourceClient) {
  return createHttpResourceDeleter({
    resourceKind: "agent",
    baseUrl: "http://agent-admin.local",
    deletePath: "/admin/agents",
    readClient,
  });
}

describe("createHttpResourceDeleter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves the id through the kind's EXISTING read client", async () => {
    const result = await deleter(foundClient).findOwnedId(
      "acme",
      "support-agent",
      "demo"
    );
    expect(result).toEqual({ ok: true, value: "ext-1" });
  });

  it("returns null (→ not_found) when the read client finds nothing", async () => {
    const result = await deleter(missingClient).findOwnedId(
      "acme",
      "support-agent",
      "demo"
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it("surfaces a failing lookup as a typed lookup_failed error — never a guessed id", async () => {
    const result = await deleter(brokenClient).findOwnedId(
      "acme",
      "support-agent",
      "demo"
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("lookup_failed");
    expect(result.error.message).toContain("HTTP 503");
  });

  it("issues DELETE <base><path>/<id> with the tenant header", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calledUrl = String(url);
      calledInit = init;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const result = await deleter(foundClient).deleteById(
      "acme",
      "ext-1",
      "support-agent"
    );

    expect(calledUrl).toBe("http://agent-admin.local/admin/agents/ext-1");
    expect(calledInit?.method).toBe("DELETE");
    expect((calledInit?.headers as Record<string, string>)[TENANT_HEADER]).toBe(
      "acme"
    );
    expect(result).toEqual({ ok: true, value: { deleted: true } });
  });

  it("maps a downstream 404 to deleted:false (already gone), never an error", async () => {
    globalThis.fetch = mock(
      async () => new Response("not found", { status: 404 })
    ) as unknown as typeof fetch;

    const result = await deleter(foundClient).deleteById(
      "acme",
      "ext-1",
      "support-agent"
    );
    expect(result).toEqual({ ok: true, value: { deleted: false } });
  });

  it("maps agent-admin's live `200 false` answer to deleted:false", async () => {
    // Live-verified 2026-08-12: DELETE /admin/skills|system-variables|
    // knowledge-bases/<unknown id> answers HTTP 200 with the body `false`.
    globalThis.fetch = mock(
      async () => new Response("false", { status: 200 })
    ) as unknown as typeof fetch;

    const result = await createHttpDeleteById({
      resourceKind: "skill",
      baseUrl: "http://agent-admin.local",
      deletePath: "/admin/skills",
    })("acme", "ext-1", "greeter");

    expect(result).toEqual({ ok: true, value: { deleted: false } });
  });

  it("treats `200 true` as a real deletion", async () => {
    globalThis.fetch = mock(
      async () => new Response("true", { status: 200 })
    ) as unknown as typeof fetch;

    const result = await createHttpDeleteById({
      resourceKind: "skill",
      baseUrl: "http://agent-admin.local",
      deletePath: "/admin/skills",
    })("acme", "ext-1", "greeter");

    expect(result).toEqual({ ok: true, value: { deleted: true } });
  });

  it("returns a typed downstream_error on a 5xx", async () => {
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 500 })
    ) as unknown as typeof fetch;

    const result = await deleter(foundClient).deleteById(
      "acme",
      "ext-1",
      "support-agent"
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({
      kind: "downstream_error",
      resourceKind: "agent",
      resourceName: "support-agent",
    });
  });

  it("returns a typed downstream_error when the network call throws", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await deleter(foundClient).deleteById(
      "acme",
      "ext-1",
      "support-agent"
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("ECONNREFUSED");
  });
});
