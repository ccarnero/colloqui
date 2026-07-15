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

  it("create: knowledgeBaseRefs is logged, not resolved (T06 scope) — creation still succeeds", async () => {
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

  it("update: existence-only kind — never exercised, safe no-op", async () => {
    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = { name: "support-agent", profile: {} };
    const result = await writer.update("tenant-a", "agent-1", agent, []);
    expect(result.ok).toBe(true);
  });
});
