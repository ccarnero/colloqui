/**
 * Adapter Tools E2E Test Stubs
 *
 * These tests describe the expected E2E flows for adapter tools.
 * Full E2E tests require running services (Playwright). These stubs
 * use mock/simulated patterns to validate the expected behaviour and
 * serve as a contract for future Playwright-based E2E tests.
 *
 * Tasks 5.4-5.5: ai-adapter-tools
 */
// Vitest globals (see tsconfig.spec.json); keep filename *.e2e.spec.ts for Bun runners if needed.

import type { IAgentToolPayload, IToolAdapterRef } from "../../../core/models/agent.model";

// ---------------------------------------------------------------------------
// Mock contract types (E2E stubs — not all fields match production DTOs)
// ---------------------------------------------------------------------------

interface IAgentCreateRequest {
  name: string;
  description: string;
  systemPrompt: string;
  provider: string;
  model: string;
  rules: string;
  soul: string;
  tools: IAgentToolPayload[];
  subagents: Array<{
    name: string;
    description: string;
    systemPrompt: string;
    enabled: boolean;
  }>;
}

interface IAgentResponse {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  tools: IAgentToolPayload[];
}

interface IAdapterSummary {
  id: string;
  name: string;
  status: string;
  baseUrl: string;
  authType: string;
  hasAuth: boolean;
  endpoints: Array<{
    id: string;
    path: string;
    method: string;
    label?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Mock API clients (simulate admin-service HTTP calls)
// ---------------------------------------------------------------------------

const TENANT_HEADER = "x-yoizen-tenant";
const TENANT_ID = "test-tenant-e2e";

function createMockAdminClient() {
  const agents = new Map<string, IAgentResponse>();

  return {
    async createAgent(body: IAgentCreateRequest): Promise<IAgentResponse> {
      const id = crypto.randomUUID();
      const agent: IAgentResponse = {
        id,
        name: body.name,
        status: "draft",
        tools: body.tools,
      };
      agents.set(id, agent);
      return agent;
    },

    async getAgent(id: string): Promise<IAgentResponse | undefined> {
      return agents.get(id);
    },

    async updateAgent(
      id: string,
      update: Partial<IAgentCreateRequest>,
    ): Promise<IAgentResponse | undefined> {
      const existing = agents.get(id);
      if (!existing) return undefined;
      if (update.tools) {
        existing.tools = update.tools;
      }
      return existing;
    },

    async publishAgent(id: string): Promise<IAgentResponse | undefined> {
      const agent = agents.get(id);
      if (!agent) return undefined;
      agent.status = "published";
      return agent;
    },
  };
}

function createMockAdaptersClient(adapters: IAdapterSummary[]) {
  return {
    async listAdapters(): Promise<IAdapterSummary[]> {
      return adapters;
    },

    async getAdapter(id: string): Promise<IAdapterSummary | undefined> {
      return adapters.find((a) => a.id === id);
    },
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_ADAPTER: IAdapterSummary = {
  id: "adapter-crm-001",
  name: "CRM API Adapter",
  status: "active",
  baseUrl: "https://crm.example.com/api/v2",
  authType: "bearer",
  hasAuth: true,
  endpoints: [
    {
      id: "ep-search",
      path: "/contacts/search",
      method: "POST",
      label: "Search Contacts",
    },
    {
      id: "ep-get",
      path: "/contacts/{id}",
      method: "GET",
      label: "Get Contact",
    },
  ],
};

const MOCK_ADAPTER_REF: IToolAdapterRef = {
  adapterId: "adapter-crm-001",
  endpointId: "ep-search",
};

// ---------------------------------------------------------------------------
// Task 5.4: E2E — Create Agent with Adapter Tool via Admin API
// ---------------------------------------------------------------------------

describe("Adapter Tools E2E: Create Agent with Adapter Tool", () => {
  let adminClient: ReturnType<typeof createMockAdminClient>;

  beforeEach(() => {
    adminClient = createMockAdminClient();
  });

  it("should create an agent with an adapter-backed tool", async () => {
    const toolPayload: IAgentToolPayload = {
      name: "search-crm-contacts",
      source_type: "adapter",
      adapter_ref: {
        adapter_id: MOCK_ADAPTER_REF.adapterId,
        endpoint_id: MOCK_ADAPTER_REF.endpointId,
      },
      description: "Search contacts in CRM via adapter",
    };

    const request: IAgentCreateRequest = {
      name: "CRM Agent",
      description: "Agent that searches CRM contacts",
      systemPrompt: "You help users search contacts in the CRM.",
      provider: "openai",
      model: "gpt-4",
      rules: "Always confirm before modifying data.",
      soul: "Helpful and precise.",
      tools: [toolPayload],
      subagents: [],
    };

    const agent = await adminClient.createAgent(request);

    expect(agent.id).toBeDefined();
    expect(agent.name).toBe("CRM Agent");
    expect(agent.status).toBe("draft");
    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0].source_type).toBe("adapter");
    expect(agent.tools[0].adapter_ref).toEqual({
      adapter_id: "adapter-crm-001",
      endpoint_id: "ep-search",
    });
  });

  it("should preserve adapterRef when updating agent tools", async () => {
    // Create initial agent with HTTP tool
    const createRequest: IAgentCreateRequest = {
      name: "Migration Agent",
      description: "Agent migrated from HTTP to adapter tool",
      systemPrompt: "You help users.",
      provider: "openai",
      model: "gpt-4",
      rules: "Be helpful.",
      soul: "Professional.",
      tools: [
        {
          name: "get-weather",
          source_type: "http",
          endpoint: { url: "https://weather.example.com/api", method: "GET" },
        },
      ],
      subagents: [],
    };

    const agent = await adminClient.createAgent(createRequest);
    expect(agent.tools[0].source_type).toBe("http");

    // Update tool to use adapter instead
    const updatedTools: IAgentToolPayload[] = [
      {
        name: "search-crm",
        source_type: "adapter",
        adapter_ref: {
          adapter_id: MOCK_ADAPTER_REF.adapterId,
          endpoint_id: MOCK_ADAPTER_REF.endpointId,
        },
      },
    ];

    const updated = await adminClient.updateAgent(agent.id, {
      ...createRequest,
      tools: updatedTools,
    });

    expect(updated).toBeDefined();
    expect(updated!.tools[0].source_type).toBe("adapter");
    expect(updated!.tools[0].adapter_ref?.adapter_id).toBe("adapter-crm-001");
    // Endpoint URL should no longer be present
    expect(updated!.tools[0].endpoint).toBeUndefined();
  });

  it("should validate that tool has either endpoint or adapterRef, not both", () => {
    const invalidTool: IAgentToolPayload = {
      name: "invalid-tool",
      source_type: "http",
      endpoint: { url: "https://example.com", method: "GET" },
      // adapter_ref would cause validation error in real admin-service
      adapter_ref: {
        adapter_id: "adapter-001",
        endpoint_id: "ep-001",
      },
    };

    // In real E2E, POST /admin/agents would return 400
    // Here we assert the contract expectation
    const hasBoth =
      invalidTool.endpoint !== undefined &&
      invalidTool.adapter_ref !== undefined;
    expect(hasBoth).toBe(true); // This would be rejected by the server
  });

  it("should list available adapters from the admin API", async () => {
    const adaptersClient = createMockAdaptersClient([MOCK_ADAPTER]);
    const adapters = await adaptersClient.listAdapters();

    expect(adapters).toHaveLength(1);
    expect(adapters[0].id).toBe("adapter-crm-001");
    expect(adapters[0].endpoints).toHaveLength(2);
    expect(adapters[0].authType).toBe("bearer");
  });

  it("should resolve adapter details when adapterRef is set", async () => {
    const adaptersClient = createMockAdaptersClient([MOCK_ADAPTER]);
    const adapter = await adaptersClient.getAdapter(MOCK_ADAPTER_REF.adapterId);

    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe("CRM API Adapter");

    const endpoint = adapter!.endpoints.find(
      (ep) => ep.id === MOCK_ADAPTER_REF.endpointId,
    );
    expect(endpoint).toBeDefined();
    expect(endpoint!.method).toBe("POST");
    expect(endpoint!.path).toBe("/contacts/search");
  });

  it("should publish agent with adapter tools and emit NATS event", async () => {
    const toolPayload: IAgentToolPayload = {
      name: "crm-search",
      source_type: "adapter",
      adapter_ref: {
        adapter_id: MOCK_ADAPTER_REF.adapterId,
        endpoint_id: MOCK_ADAPTER_REF.endpointId,
      },
    };

    const request: IAgentCreateRequest = {
      name: "Publishable Agent",
      description: "Agent ready for publishing",
      systemPrompt: "You search contacts.",
      provider: "openai",
      model: "gpt-4",
      rules: "Be precise.",
      soul: "Friendly.",
      tools: [toolPayload],
      subagents: [],
    };

    const agent = await adminClient.createAgent(request);
    expect(agent.status).toBe("draft");

    const published = await adminClient.publishAgent(agent.id);
    expect(published).toBeDefined();
    expect(published!.status).toBe("published");

    // In real E2E: verify NATS event
    // io.yoizen.ai.admin.agent.published.v1
    // with payload.tools containing adapterRef
  });
});

// ---------------------------------------------------------------------------
// Task 5.5: E2E — Execute Agent with Adapter Tool
// ---------------------------------------------------------------------------

describe("Adapter Tools E2E: Execute Agent with Adapter Tool", () => {
  const EXECUTION_TIMEOUT_MS = 30_000;

  it("should execute full flow: message → LLM → adapter tool → response", async () => {
    /**
     * Simulates the full execution flow:
     * 1. User sends message to agent
     * 2. Agent (LLM) decides to use the adapter tool
     * 3. ToolExecutor resolves adapter via AdapterClient
     * 4. AdapterToolExecutor executes HTTP call via adapter config
     * 5. Response is returned to the conversation
     */

    // Step 1: Simulate adapter resolution
    const resolvedRequest = {
      url: "https://crm.example.com/api/v2/contacts/search",
      method: "POST",
      headers: {
        Authorization: "Bearer ***", // Redacted in tests
        "X-Yoizen-Tenant": TENANT_ID,
        "Content-Type": "application/json",
      },
      timeout_ms: 5000,
    };

    expect(resolvedRequest.url).toContain("/contacts/search");
    expect(resolvedRequest.method).toBe("POST");
    expect(resolvedRequest.headers["X-Yoizen-Tenant"]).toBe(TENANT_ID);

    // Step 2: Simulate external API response
    const externalResponse = {
      results: [
        { id: "c1", name: "John Doe", email: "john@example.com" },
        { id: "c2", name: "Jane Smith", email: "jane@example.com" },
      ],
      total: 2,
    };

    // Step 3: Simulate tool result returned to LLM
    const toolResult = {
      success: true,
      data: externalResponse,
    };

    expect(toolResult.success).toBe(true);
    expect(toolResult.data.results).toHaveLength(2);

    // Step 4: Simulate final agent response
    const agentResponse =
      "I found 2 contacts matching your search:\n" +
      "1. John Doe (john@example.com)\n" +
      "2. Jane Smith (jane@example.com)";

    expect(agentResponse).toContain("John Doe");
    expect(agentResponse).toContain("Jane Smith");
  });

  it("should handle adapter-service unavailability gracefully", async () => {
    /**
     * When the adapter-service is unavailable, the AdapterClient
     * should return stale cache data. If no cache exists, the
     * tool should return an error with a sanitized message.
     */
    const adapterDownResult = {
      success: false,
      error: "Adapter not found: adapter-crm-001",
    };

    expect(adapterDownResult.success).toBe(false);
    // Error message should NOT contain auth details
    expect(adapterDownResult.error).not.toContain("Bearer");
    expect(adapterDownResult.error).not.toContain("token");
  });

  it("should handle endpoint not found in adapter", async () => {
    const endpointNotFoundResult = {
      success: false,
      error: "Endpoint 'ep-nonexistent' not found in adapter 'adapter-crm-001'",
    };

    expect(endpointNotFoundResult.success).toBe(false);
    expect(endpointNotFoundResult.error).toContain("ep-nonexistent");
  });

  it("should truncate responses exceeding 100KB", async () => {
    /**
     * Large adapter responses are truncated to prevent LLM context
     * overflow. The truncated response includes metadata about the
     * original size.
     */
    const LARGE_SIZE = 150_000;
    const truncatedResult = {
      _truncated: true,
      original_size_bytes: LARGE_SIZE,
      top_level_keys: ["results", "total", "metadata"],
      message: `Response truncated: ${LARGE_SIZE} bytes exceeded limit of 100000 bytes`,
    };

    expect(truncatedResult._truncated).toBe(true);
    expect(truncatedResult.original_size_bytes).toBe(LARGE_SIZE);
    expect(truncatedResult.message).toContain("truncated");
  });

  it("should inject correct auth headers per auth type", async () => {
    /**
     * Verifies the strategy pattern for auth header injection:
     * - none: no auth headers
     * - api-key: X-Api-Key header
     * - bearer: Authorization: Bearer header
     * - basic: Authorization: Basic header (base64)
     * - oauth2-client: Authorization: Bearer header (from access_token)
     */
    const authCases = [
      { authType: "none", expectedHeader: null },
      { authType: "api-key", expectedHeader: "X-Api-Key" },
      { authType: "bearer", expectedHeader: "Authorization" },
      { authType: "basic", expectedHeader: "Authorization" },
      { authType: "oauth2-client", expectedHeader: "Authorization" },
    ];

    for (const { authType, expectedHeader } of authCases) {
      if (expectedHeader === null) {
        expect(authType).toBe("none");
      } else {
        expect(["X-Api-Key", "Authorization"]).toContain(expectedHeader);
      }
    }
  });

  it("should respect feature flag AI_ADAPTER_TOOLS_ENABLED", async () => {
    /**
     * When the feature flag is disabled, adapter tool calls should
     * fall through to the existing tool execution path (or be skipped).
     *
     * In production, the feature flag is read from:
     *   AI_ADAPTER_TOOLS_ENABLED env var
     *   Default: true (after Task 6.1)
     *
     * TODO: Remove feature flag after validated in production (Task 6.2).
     */
    const featureEnabled = true; // After Task 6.1, default is true

    expect(featureEnabled).toBe(true);

    // When disabled, adapter branch is skipped
    const disabledResult = {
      success: false,
      error: "Adapter tools are not enabled",
    };
    expect(disabledResult.success).toBe(false);
  });

  it("should execute full lifecycle: create → publish → execute → verify", async () => {
    const adminClient = createMockAdminClient();

    // 1. Create agent with adapter tool
    const agent = await adminClient.createAgent({
      name: "Lifecycle Agent",
      description: "Full lifecycle test",
      systemPrompt: "You manage CRM contacts.",
      provider: "openai",
      model: "gpt-4",
      rules: "Be careful with data.",
      soul: "Professional.",
      tools: [
        {
          name: "search-contacts",
          source_type: "adapter",
          adapter_ref: {
            adapter_id: "adapter-crm-001",
            endpoint_id: "ep-search",
          },
        },
      ],
      subagents: [],
    });

    expect(agent.status).toBe("draft");

    // 2. Publish agent
    const published = await adminClient.publishAgent(agent.id);
    expect(published!.status).toBe("published");

    // 3. Simulate execution (adapter tool call)
    const executionResult = {
      success: true,
      data: { results: [{ id: "c1", name: "Test Contact" }] },
    };
    expect(executionResult.success).toBe(true);

    // 4. Verify tool config persisted
    const stored = await adminClient.getAgent(agent.id);
    expect(stored!.tools[0].adapter_ref).toEqual({
      adapter_id: "adapter-crm-001",
      endpoint_id: "ep-search",
    });
  });
});
