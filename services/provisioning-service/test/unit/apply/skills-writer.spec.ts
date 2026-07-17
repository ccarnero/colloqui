import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ManifestSkill } from "@yoizen/shared";
import { createSkillsWriter } from "../../../src/modules/apply/infrastructure/skills-writer";

const BASE_URL = "http://agent-admin-service.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createSkillsWriter (skillsWriter)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("create: POSTs name/system_prompt (+ every declared optional field, incl. files[]) to /admin/skills", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method as string;
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "skill-1" }, 201);
    }) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "refund-policy-expert",
      description: "Expert handling of refund requests.",
      system_prompt: "You are the refund-policy expert.",
      icon: "currency_exchange",
      color: "#66bb6a",
      trigger_commands: ["refund", "reembolso"],
      when_to_use: "Use for refund questions.",
      priority: 10,
      allowed_tools: [],
      mode: "llm_driven",
      files: [
        {
          name: "refund-cheatsheet.md",
          path: "reference/refund-cheatsheet.md",
          type: "reference",
          content: "# cheat sheet",
        },
      ],
    };

    const result = await writer.create("tenant-a", skill);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.externalId).toBe("skill-1");
    }
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toBe(`${BASE_URL}/admin/skills`);
    expect(capturedBody).toEqual({
      name: "refund-policy-expert",
      description: "Expert handling of refund requests.",
      system_prompt: "You are the refund-policy expert.",
      icon: "currency_exchange",
      color: "#66bb6a",
      trigger_commands: ["refund", "reembolso"],
      when_to_use: "Use for refund questions.",
      priority: 10,
      allowed_tools: [],
      mode: "llm_driven",
      files: [
        {
          name: "refund-cheatsheet.md",
          path: "reference/refund-cheatsheet.md",
          type: "reference",
          content: "# cheat sheet",
        },
      ],
    });
  });

  it("create: a skill with only the two required fields omits every optional key (server applies its own defaults)", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "skill-2" }, 201);
    }) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "minimal-skill",
      system_prompt: "Minimal prompt.",
    };

    const result = await writer.create("tenant-a", skill);
    expect(result.ok).toBe(true);
    expect(capturedBody).toEqual({
      name: "minimal-skill",
      system_prompt: "Minimal prompt.",
    });
  });

  it("create: a network failure fails loud with a typed downstream_error, never fabricating an externalId", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "network-fail-skill",
      system_prompt: "prompt",
    };

    const result = await writer.create("tenant-a", skill);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
      expect(result.error.resourceKind).toBe("skill");
      expect(result.error.resourceName).toBe("network-fail-skill");
    }
  });

  it("create: a non-2xx HTTP response fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () =>
      json({ message: "conflict" }, 409)
    ) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "conflict-skill",
      system_prompt: "prompt",
    };

    const result = await writer.create("tenant-a", skill);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });

  it("create: malformed JSON in the create response fails loud with a typed downstream_error (never throws)", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("not json", {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "malformed-skill",
      system_prompt: "prompt",
    };

    const result = await writer.create("tenant-a", skill);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });

  it("update: PATCHes /admin/skills/:id with the full desired body (normal 200 path — decision 5, the historical 500 is fixed)", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method as string;
      capturedBody = JSON.parse(init.body as string);
      return json({ id: "skill-1" }, 200);
    }) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "refund-policy-expert",
      system_prompt: "Updated prompt.",
      priority: 20,
    };

    const result = await writer.update("tenant-a", "skill-1", skill, [
      { field: "priority", current: 10, desired: 20 },
    ]);
    expect(result.ok).toBe(true);
    expect(capturedMethod).toBe("PATCH");
    expect(capturedUrl).toBe(`${BASE_URL}/admin/skills/skill-1`);
    expect(capturedBody).toEqual({
      name: "refund-policy-expert",
      system_prompt: "Updated prompt.",
      priority: 20,
    });
  });

  it("update: a network failure fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "refund-policy-expert",
      system_prompt: "prompt",
    };

    const result = await writer.update("tenant-a", "skill-1", skill, [
      { field: "priority", current: 10, desired: 20 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });

  it("update: a non-2xx HTTP response fails loud with a typed downstream_error", async () => {
    globalThis.fetch = mock(async () =>
      json({ message: "not found" }, 404)
    ) as unknown as typeof fetch;

    const writer = createSkillsWriter(BASE_URL);
    const skill: ManifestSkill = {
      name: "refund-policy-expert",
      system_prompt: "prompt",
    };

    const result = await writer.update("tenant-a", "missing-id", skill, [
      { field: "priority", current: 10, desired: 20 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("downstream_error");
    }
  });
});
