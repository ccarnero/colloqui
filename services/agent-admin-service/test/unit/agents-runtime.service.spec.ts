import "../setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { BadGatewayException, NotFoundException } from "@nestjs/common";
import { AgentsRuntimeService } from "../../src/modules/agents/agents-runtime.service";

describe("AgentsRuntimeService", () => {
  let service: AgentsRuntimeService;
  const request = vi.fn();
  const findAll = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    request.mockReset();
    findAll.mockReset();
    findAll.mockResolvedValue({ variables: [], total: 0 });

    service = new AgentsRuntimeService(
      {
        getConnection: vi.fn().mockResolvedValue({ request }),
      },
      { findAll } as unknown as ConstructorParameters<
        typeof AgentsRuntimeService
      >[1]
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("includes user_id in chat payload and parses envelope responses", async () => {
    request.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          data: {
            payload: {
              response: "Hello from runtime",
              tool_calls: [{ name: "memory.search" }],
            },
          },
        })
      ),
    });

    const result = await service.chat(
      "acme",
      "agent-1",
      {
        message: "hello",
        customerName: "Nahuel",
        context: [],
      },
      "user-42"
    );

    const [subject, payload] = request.mock.calls[0] as [string, string];
    const parsedPayload = JSON.parse(payload) as {
      data: { payload: { user_id?: string } };
    };

    expect(subject).toContain("chat_respond.v1");
    expect(parsedPayload.data.payload.user_id).toBe("user-42");
    expect(result).toEqual({
      reply: "Hello from runtime",
      tool_calls: [{ name: "memory.search" }],
    });
  });

  it("attaches a VariableResolutionContext built from system variables to the chat_respond payload", async () => {
    findAll.mockResolvedValue({
      variables: [
        {
          id: "var-1",
          name: "crm-support-company-name",
          type: "string",
          value: "Acme Telco",
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: "var-2",
          name: "crm-support-api-key",
          type: "secret",
          value: "sk-live-abc123",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      total: 2,
    });
    request.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          data: { payload: { response: "hi", tool_calls: [] } },
        })
      ),
    });

    await service.chat("acme", "agent-1", {
      message: "hello",
      context: [],
    });

    expect(findAll).toHaveBeenCalledWith("acme");

    const [, payload] = request.mock.calls[0] as [string, string];
    const parsedPayload = JSON.parse(payload) as {
      data: {
        payload: {
          variables?: {
            system: Record<string, unknown>;
            workflow: Record<string, unknown>;
            previous: Record<string, unknown>;
            node: Record<string, unknown>;
            request: Record<string, unknown>;
          };
        };
      };
    };

    // Mirrors the published-runtime path (workflow-service's
    // SystemVariablesProvider / WorkflowsService): the shape is the full
    // VariableResolutionContext, with active system variables flattened
    // into `system` as a flat `{ name: value }` map — including
    // `secret`-typed values, which the runtime path forwards unmasked too
    // because the template renderer needs the raw value to resolve
    // `{{variables.system.*}}` placeholders.
    expect(parsedPayload.data.payload.variables).toEqual({
      system: {
        "crm-support-company-name": "Acme Telco",
        "crm-support-api-key": "sk-live-abc123",
      },
      workflow: {},
      previous: {},
      node: {},
      request: {},
    });
  });

  it("degrades to an empty variables context instead of failing the chat when the system-variables lookup errors", async () => {
    findAll.mockRejectedValue(new Error("connection refused"));
    request.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          data: { payload: { response: "hi", tool_calls: [] } },
        })
      ),
    });

    const result = await service.chat("acme", "agent-1", {
      message: "hello",
      context: [],
    });

    expect(result).toEqual({ reply: "hi", tool_calls: [] });

    const [, payload] = request.mock.calls[0] as [string, string];
    const parsedPayload = JSON.parse(payload) as {
      data: { payload: { variables?: { system: Record<string, unknown> } } };
    };

    expect(parsedPayload.data.payload.variables).toEqual({
      system: {},
      workflow: {},
      previous: {},
      node: {},
      request: {},
    });
  });

  it("lists memory proposals via HTTP against agent-memory-service (not NATS)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "proposal-1",
              kind: "fact",
              title: "Known preference",
              content: "Prefers morning follow-ups and concise answers.",
              status: "proposed",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          total: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.listMemoryProposals("acme");

    expect(request).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/admin/memories/proposals");
    expect((init.headers as Record<string, string>)["x-yoizen-tenant"]).toBe(
      "acme"
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toEqual({
      id: "proposal-1",
      kind: "fact",
      title: "Known preference",
      content_excerpt: "Prefers morning follow-ups and concise answers.",
      status: "proposed",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
  });

  it("times out listing memory proposals instead of hanging when agent-memory-service is unreachable", async () => {
    const originalTimeout = process.env.AGENT_MEMORY_SERVICE_TIMEOUT_MS;
    process.env.AGENT_MEMORY_SERVICE_TIMEOUT_MS = "50";

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    ) as unknown as typeof fetch;

    try {
      await expect(service.listMemoryProposals("acme")).rejects.toThrow(
        BadGatewayException
      );
    } finally {
      process.env.AGENT_MEMORY_SERVICE_TIMEOUT_MS = originalTimeout;
    }
  });

  it("approves a memory proposal via HTTP PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "proposal-2",
          status: "active",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.reviewMemoryProposal(
      "acme",
      "proposal-2",
      "memory_proposals_approve",
      "reviewer-7",
      "Looks valid"
    );

    expect(request).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/admin/memories/proposal-2/approve");
    expect(init.method).toBe("PATCH");

    expect(result).toEqual({
      success: true,
      proposal: {
        id: "proposal-2",
        kind: undefined,
        title: undefined,
        content_excerpt: undefined,
        status: "active",
        created_at: undefined,
        updated_at: undefined,
      },
    });
  });

  it("rejects a memory proposal via HTTP PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "proposal-3", status: "rejected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.reviewMemoryProposal(
      "acme",
      "proposal-3",
      "memory_proposals_reject"
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/admin/memories/proposal-3/reject");
    expect(init.method).toBe("PATCH");
    expect(result.success).toBe(true);
  });

  it("surfaces a 404 from agent-memory-service as NotFoundException", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("not found", { status: 404 })
      ) as unknown as typeof fetch;

    await expect(
      service.reviewMemoryProposal(
        "acme",
        "missing",
        "memory_proposals_approve"
      )
    ).rejects.toThrow(NotFoundException);
  });
});
