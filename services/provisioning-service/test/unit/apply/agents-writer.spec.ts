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
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method as string });
      if (init.body) {
        capturedBody = JSON.parse(init.body as string);
      }
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
    // T01 (manual-loops/provisioning-manifest-gaps-5.md): create() always
    // publishes as its last step.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toBe(`${BASE_URL}/admin/agents/agent-1/publish`);
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
      if (init.body) {
        capturedBody = JSON.parse(init.body as string);
      }
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

  it("update: existence-only kind — never exercised, safe no-op except the T01 publish call every update() issues", async () => {
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method as string });
      return json({ id: "agent-1" }, 200);
    }) as unknown as typeof fetch;

    const writer = createAgentsWriter(BASE_URL);
    const agent: Agent = { name: "support-agent", profile: {} };
    const result = await writer.update("tenant-a", "agent-1", agent, []);
    expect(result.ok).toBe(true);
    // T01: update() always re-publishes, even with no declared MCP fields.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(`${BASE_URL}/admin/agents/agent-1/publish`);
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

      expect(calls).toHaveLength(3);
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
      // T01: publish is the LAST call, after the mcp-servers PATCH.
      expect(calls[2]?.method).toBe("POST");
      expect(calls[2]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
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
      expect(calls).toHaveLength(2);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[1]?.method).toBe("POST");
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
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

      expect(calls).toHaveLength(5);
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
      // T01 — regression: publish is captured as the LAST call, strictly
      // after every reconcile PATCH (mcp-servers, mcp-tools,
      // tool-descriptions), never before.
      expect(calls[4]?.method).toBe("POST");
      expect(calls[4]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
      expect(calls[4]?.body).toBeUndefined();
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
      expect(calls).toHaveLength(2);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
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
      expect(calls).toHaveLength(3);
      expect(calls[0]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/mcp-tools`
      );
      expect(calls[1]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/tool-descriptions`
      );
      // T01: update() publishes as the LAST step, after both reconcile
      // PATCHes.
      expect(calls[2]?.method).toBe("POST");
      expect(calls[2]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
      expect(calls[2]?.body).toBeUndefined();
    });

    it("update: no PATCHes when neither field is declared — matches the pre-T04 existence-only no-op except the T01 publish call every update() issues", async () => {
      const calls: { url: string; method: string }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method as string });
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };
      const result = await writer.update("tenant-a", "agent-1", agent, []);
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("POST");
      expect(calls[0]?.url).toBe(`${BASE_URL}/admin/agents/agent-1/publish`);
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

      expect(calls).toHaveLength(4);
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
      // T01: publish is still the LAST call after all three reconcile PATCHes.
      expect(calls[3]?.method).toBe("POST");
      expect(calls[3]?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
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

  // T01 (manual-loops/provisioning-manifest-gaps-5.md): `publishAgent` —
  // `create()`/`update()` both call `POST .../publish` unconditionally as
  // their LAST step, so the created/updated agent actually becomes visible
  // to agent-ai-service (see this file's header comment and the SPEC's
  // motivating incident).
  describe("publish (T01)", () => {
    it("create: happy path — the publish POST carries no body and no x-yoizen-user-id header", async () => {
      const calls: { url: string; method: string; init: RequestInit }[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method as string, init });
        if (init.method === "POST" && !url.endsWith("/publish")) {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ id: "agent-uuid-1" }, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(true);

      expect(calls).toHaveLength(2);
      const publishCall = calls[1];
      expect(publishCall?.method).toBe("POST");
      expect(publishCall?.url).toBe(
        `${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
      expect(publishCall?.init.body).toBeUndefined();
      const publishHeaders = publishCall?.init.headers as
        | Record<string, string>
        | undefined;
      expect(publishHeaders?.["x-yoizen-user-id"]).toBeUndefined();
    });

    it("create: publish network failure (throw) surfaces downstream_error — create() never returns ok:true", async () => {
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        if (init.method === "POST" && !url.endsWith("/publish")) {
          return json({ id: "agent-uuid-1" }, 201);
        }
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.resourceKind).toBe("agent");
      }
    });

    it("create: publish non-2xx response surfaces downstream_error — create() never returns ok:true", async () => {
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        if (init.method === "POST" && !url.endsWith("/publish")) {
          return json({ id: "agent-uuid-1" }, 201);
        }
        return json({ message: "server error" }, 500);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = { name: "support-agent", profile: {} };

      const result = await writer.create("tenant-a", agent);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("downstream_error");
        expect(result.error.resourceKind).toBe("agent");
      }
    });

    it("update: publish network failure (throw) after reconcile surfaces downstream_error — update() never returns ok:true", async () => {
      globalThis.fetch = mock(async (url: string) => {
        if (url.endsWith("/publish")) {
          throw new Error("ECONNREFUSED");
        }
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
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
    });

    it("update: publish non-2xx response after reconcile surfaces downstream_error — update() never returns ok:true", async () => {
      globalThis.fetch = mock(async (url: string) => {
        if (url.endsWith("/publish")) {
          return json({ message: "server error" }, 500);
        }
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
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
    });

    it("update: publish call comes strictly AFTER the mcp-tools/tool-descriptions reconcile PATCHes (request-sequence regression)", async () => {
      const sequence: string[] = [];
      globalThis.fetch = mock(async (url: string, init: RequestInit) => {
        sequence.push(`${init.method as string} ${url}`);
        return json({}, 200);
      }) as unknown as typeof fetch;

      const writer = createAgentsWriter(BASE_URL);
      const agent: Agent = {
        name: "support-agent",
        profile: {},
        enabledMcpServerRefs: ["github-mcp"],
        enabledMcpTools: { "github-mcp": ["search_code"] },
        toolDescriptionOverrides: { "github-mcp:search_code": "desc" },
      };

      const result = await writer.update("tenant-a", "agent-uuid-1", agent, [
        { field: "enabledMcpTools" },
      ]);
      expect(result.ok).toBe(true);

      // Regression: the publish index must come after every reconcile PATCH
      // index — proves ordering, not just presence, so a future refactor
      // that accidentally moves publish earlier (see Prior art's
      // snapshot-staleness citation on why order matters) is caught here.
      const publishIndex = sequence.indexOf(
        `POST ${BASE_URL}/admin/agents/agent-uuid-1/publish`
      );
      const mcpServersIndex = sequence.indexOf(
        `PATCH ${BASE_URL}/admin/agents/agent-uuid-1/mcp-servers`
      );
      const mcpToolsIndex = sequence.indexOf(
        `PATCH ${BASE_URL}/admin/agents/agent-uuid-1/mcp-tools`
      );
      const toolDescriptionsIndex = sequence.indexOf(
        `PATCH ${BASE_URL}/admin/agents/agent-uuid-1/tool-descriptions`
      );
      expect(publishIndex).toBeGreaterThan(-1);
      expect(mcpServersIndex).toBeGreaterThan(-1);
      expect(mcpToolsIndex).toBeGreaterThan(-1);
      expect(toolDescriptionsIndex).toBeGreaterThan(-1);
      expect(publishIndex).toBeGreaterThan(mcpServersIndex);
      expect(publishIndex).toBeGreaterThan(mcpToolsIndex);
      expect(publishIndex).toBeGreaterThan(toolDescriptionsIndex);
    });

    // Reviewer-facing note (not a runtime assertion): this file adds no new
    // writer-level "noop" test for the publish step. Verified against
    // `comparable-fields.ts:325-350` (`agentComparable` — existence-only for
    // `enabledMcpTools`/`toolDescriptionOverrides`, the ONLY trigger for an
    // `update()` verdict today) and
    // `src/modules/apply/lib/apply-manifest.ts` (the planner's own
    // create/update-only invocation contract: `if (entry.external ||
    // entry.verdict === "noop") { ... continue }` skips the writer entirely
    // before `writer.create`/`writer.update` is ever reached — confirmed by
    // reading both files directly for this task). Since `create()`/
    // `update()` are only ever invoked by the apply engine for a genuine
    // `create`/`update` verdict, and never for `noop`, there is no
    // writer-level "unchanged agent" path left to exercise here — the
    // planner-level noop contract belongs in `apply-manifest.spec.ts`, not
    // this file. If a reviewer believes that claim is wrong, the correction
    // belongs there, not a silently-added noop test in this spec.
  });
});
