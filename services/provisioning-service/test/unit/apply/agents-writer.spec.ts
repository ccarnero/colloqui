import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Agent } from "@yoizen/shared";
import { createAgentsWriter } from "../../../src/modules/apply/infrastructure/agents-writer";

const BASE_URL = "http://agent-admin-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAgentsWriter", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: passes through recognized profile fields, ignores unrecognized ones", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "agent-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = {
      name: "support-agent",
      profile: { system_prompt: "help", not_a_real_field: "ignored" },
    };

    const result = await writer.create("tenant-a", agent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("agent-1");
    }
    expect(capturedBody).toMatchObject({
      name: "support-agent",
      system_prompt: "help",
    });
    expect(
      (capturedBody as Record<string, unknown>).not_a_real_field
    ).toBeUndefined();
  });

  it("create: without a KB reconciler context, knowledgeBaseRefs is logged (not resolved) — creation still succeeds (pre-T06 back-compat)", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "agent-1" }, 201)
    ) as unknown as typeof fetch;

    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = {
      name: "support-agent",
      profile: {},
      knowledgeBaseRefs: ["kb-1"],
    };

    const result = await writer.create("tenant-a", agent);
    expect(result.ok).toBe(true);
  });

  it("create (T06): resolves knowledgeBaseRefs to knowledge_base_ids via the writer context map", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "agent-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = {
      name: "support-agent",
      profile: {},
      knowledgeBaseRefs: ["kb-1", "kb-2"],
    };

    const result = await writer.create("tenant-a", agent, {
      knowledgeBaseExternalIds: new Map([
        ["kb-1", "kb-uuid-1"],
        ["kb-2", "kb-uuid-2"],
      ]),
    });

    expect(result.ok).toBe(true);
    expect(capturedBody).toMatchObject({
      knowledge_base_ids: ["kb-uuid-1", "kb-uuid-2"],
    });
  });

  it("create (T06): a knowledgeBaseRef missing from the context map fails loud with a typed error", async () => {
    globalThis.fetch = mock(async () =>
      json({ id: "agent-1" }, 201)
    ) as unknown as typeof fetch;

    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = {
      name: "support-agent",
      profile: {},
      knowledgeBaseRefs: ["kb-1", "kb-missing"],
    };

    const result = await writer.create("tenant-a", agent, {
      knowledgeBaseExternalIds: new Map([["kb-1", "kb-uuid-1"]]),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("missing_required_field");
    }
  });

  it("update: existence-only kind — never exercised, safe no-op", async () => {
    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = { name: "support-agent", profile: {} };
    const result = await writer.update("tenant-a", "agent-1", agent, []);
    expect(result.ok).toBe(true);
  });
});
