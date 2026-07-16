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

  // T06 (manual-loops/provisioning-manifest-gaps.md, gap 6):
  // enabledMcpServerRefs — reconciled via a SEPARATE PATCH call, by NAME,
  // never an id lookup (see agents-writer.ts header for the regression this
  // avoids).
  describe("enabledMcpServerRefs (T06)", () => {
    it("create: PATCHes /admin/agents/:id/mcp-servers with the manifest NAMES verbatim, never ids", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ id: "agent-uuid-1" }, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp", "deepwiki-mcp"],
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);

      expect(calls).toHaveLength(2);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[1]?.method).toBe("PATCH");
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-servers`
      );
      // The critical assertion: the PATCH body carries the manifest NAMES
      // untouched, never substituted to a real externalId/UUID.
      expect(calls[1]?.body).toEqual({
        enabled_mcp_servers: ["github-mcp", "deepwiki-mcp"],
      });
    });

    it("create: omits the mcp-servers PATCH entirely when enabledMcpServerRefs is not declared", async () => {
      const calls: { url: string; method: string }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method as string });
        return json({ id: "agent-uuid-1" }, 201);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("POST");
    });

    it("create: a PATCH failure fails loud with a typed downstream_error, never silently dropping the enablement", async () => {
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ message: "server error" }, 500);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp"],
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.resourceKind).toBe("agent");
      }
    });
  });

  // T04 (manual-loops/provisioning-manifest-gaps-2.md, gap 4):
  // enabledMcpTools/toolDescriptionOverrides — reconciled via TWO SEPARATE
  // PATCH calls, by MCP server NAME (decision 6), called AFTER the
  // enabledMcpServerRefs PATCH (T06).
  describe("enabledMcpTools / toolDescriptionOverrides (T04)", () => {
    it("create: PATCHes mcp-tools then tool-descriptions AFTER the mcp-servers PATCH, in that order", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ id: "agent-uuid-1" }, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp"],
        enabledMcpTools: { "github-mcp": ["search_code", "read_file"] },
        toolDescriptionOverrides: {
          "github-mcp:search_code": "Search the repo.",
        },
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);

      expect(calls).toHaveLength(4);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-servers`
      );
      expect(calls[2]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-tools`
      );
      expect(calls[2]?.body).toEqual({
        enabled_mcp_tools: { "github-mcp": ["search_code", "read_file"] },
      });
      expect(calls[3]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/tool-descriptions`
      );
      expect(calls[3]?.body).toEqual({
        tool_description_overrides: {
          "github-mcp:search_code": "Search the repo.",
        },
      });
    });

    it("create: omits both PATCHes when neither field is declared (absent-field no-op)", async () => {
      const calls: { url: string; method: string }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method as string });
        return json({ id: "agent-uuid-1" }, 201);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("POST");
    });

    it("create: enabledMcpTools accepts null for a server (all tools enabled)", async () => {
      let toolsBody: unknown;
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        toolsBody = JSON.parse(init.body as string);
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpTools: { "github-mcp": null },
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);
      expect(toolsBody).toEqual({ enabled_mcp_tools: { "github-mcp": null } });
    });

    it("create: a mcp-tools PATCH failure fails loud with a typed downstream_error", async () => {
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ message: "server error" }, 500);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpTools: { "github-mcp": ["search_code"] },
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.resourceKind).toBe("agent");
      }
    });

    it("create: an HTTP 400 on tool-descriptions is treated as skip (feature flag off), not a failure", async () => {
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json(
          { message: "Tool description overrides are not enabled." },
          400
        );
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        toolDescriptionOverrides: { "github-mcp:search_code": "desc" },
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);
    });

    it("create: a non-400 tool-descriptions failure still fails loud", async () => {
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ message: "server error" }, 500);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        toolDescriptionOverrides: { "github-mcp:search_code": "desc" },
      };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
      }
    });

    it("update: reconciles enabledMcpTools/toolDescriptionOverrides directly against the given externalId (T04 upgrades update() from a pure no-op for these fields)", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpTools: { "github-mcp": ["search_code"] },
        toolDescriptionOverrides: { "github-mcp:search_code": "desc" },
      };

      const result = await writer.update("tenant-a", "agent-uuid-1", agent, [
        { field: "enabledMcpTools" },
      ]);
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-tools`
      );
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/tool-descriptions`
      );
    });

    it("update: no PATCHes when neither field is declared — matches the pre-T04 existence-only no-op", async () => {
      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };
      const result = await writer.update("tenant-a", "agent-1", agent, []);
      expect(result.ok).toBe(true);
    });

    it("update: an operator changing BOTH enabledMcpServerRefs AND enabledMcpTools in one apply reconciles servers THEN tools, in create()'s order — the server-refs change is never silently dropped", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method as string,
          body: init.body ? JSON.parse(init.body as string) : undefined,
        });
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp", "deepwiki-mcp"],
        enabledMcpTools: { "github-mcp": ["search_code"] },
        toolDescriptionOverrides: { "github-mcp:search_code": "desc" },
      };

      const result = await writer.update("tenant-a", "agent-uuid-1", agent, [
        { field: "enabledMcpTools" },
      ]);
      expect(result.ok).toBe(true);

      expect(calls).toHaveLength(3);
      expect(calls[0]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-servers`
      );
      expect(calls[0]?.body).toEqual({
        enabled_mcp_servers: ["github-mcp", "deepwiki-mcp"],
      });
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-tools`
      );
      expect(calls[2]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/tool-descriptions`
      );
    });

    it("update: an enabledMcpServerRefs PATCH failure fails loud with a typed downstream_error, never proceeding to the tool PATCHes", async () => {
      const calls: string[] = [];
      globalThis.fetch = mock(async (url: string) => {
        calls.push(url);
        return json({ message: "server error" }, 500);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp"],
        enabledMcpTools: { "github-mcp": ["search_code"] },
      };

      const result = await writer.update("tenant-a", "agent-uuid-1", agent, [
        { field: "enabledMcpTools" },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.resourceKind).toBe("agent");
      }
      // Only the mcp-servers PATCH was attempted; the failure short-circuited
      // before the tool PATCHes.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-servers`
      );
    });
  });
});
