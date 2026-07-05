import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Transport,
  TransportRequestOptions,
  TransportResponse,
} from "../../../src/core/transport.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { createAgentsClient } from "../../../src/resources/agents/client.js";

interface Call extends TransportRequestOptions {}

function fakeTransport(
  handler: (
    call: Call
  ) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>
): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = {
    async request(options) {
      calls.push(options);
      return (await handler(options)) as TransportResponse<never>;
    },
  };
  return { transport, calls };
}

const sampleAgent = {
  id: "agent-1",
  name: "triage",
  description: null,
  system_prompt: "You are a helpful agent.",
  model_config: { llm: { provider: "env", model: "gpt-4o-mini" } },
  tools: [],
  enabled_tools: null,
  enabled_mcp_servers: null,
  tool_description_overrides: null,
  channels: [],
  knowledge_base_ids: [],
  input_variables: [],
  output_variables: [],
  status: "draft" as const,
  is_active: true,
  published_at: null,
  published_config: null,
  created_at: "2026-07-04T00:00:00.000Z",
  updated_at: "2026-07-04T00:00:00.000Z",
};

test("create() POSTs /admin/agents with the input body and returns the created agent", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 201,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.create({
    name: "triage",
    system_prompt: "You are a helpful agent.",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/admin/agents");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, {
    name: "triage",
    system_prompt: "You are a helpful agent.",
  });
  assert.deepEqual(result, sampleAgent);
});

test("update() PUTs /admin/agents/:id with the input body", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  await client.update("agent-1", { name: "renamed" });

  assert.equal(calls[0]!.path, "/admin/agents/agent-1");
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(calls[0]!.body, { name: "renamed" });
});

test("update() URL-encodes the agent id in the path", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });
  await client.update("agent/needs encoding", { name: "x" });
  assert.equal(calls[0]!.path, "/admin/agents/agent%2Fneeds%20encoding");
});

test("get() GETs /admin/agents/:id", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.get("agent-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, sampleAgent);
});

test("get() propagates transport errors unchanged (error-mapping passthrough)", async () => {
  const { transport } = fakeTransport(() => {
    throw new NotFoundError("request failed: not found");
  });
  const client = createAgentsClient({ transport });

  await assert.rejects(() => client.get("missing"), NotFoundError);
});

test("remove() DELETEs /admin/agents/:id and resolves with no value", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.remove("agent-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.equal(result, undefined);
});

test("publish() POSTs /admin/agents/:id/publish", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { ...sampleAgent, status: "published" as const },
  }));
  const client = createAgentsClient({ transport });

  const result = await client.publish("agent-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/publish");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(result.status, "published");
});

test("unpublish() POSTs /admin/agents/:id/unpublish", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  await client.unpublish("agent-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/unpublish");
  assert.equal(calls[0]!.method, "POST");
});

test("listVersions() GETs /admin/agents/:id/versions and returns the bare array", async () => {
  const versions = [
    {
      id: "v-1",
      agent_id: "agent-1",
      version_number: 1,
      snapshot: {},
      published_at: null,
      created_at: "2026-07-04T00:00:00.000Z",
    },
  ];
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: versions,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.listVersions("agent-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/versions");
  assert.deepEqual(result, versions);
});

test("rollbackToVersion() POSTs /admin/agents/:id/versions/:versionId/rollback", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  await client.rollbackToVersion("agent-1", "v-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/versions/v-1/rollback");
  assert.equal(calls[0]!.method, "POST");
});

test("deleteVersion() DELETEs /admin/agents/:id/versions/:versionId", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 204,
    body: undefined,
  }));
  const client = createAgentsClient({ transport });

  await client.deleteVersion("agent-1", "v-1");
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/versions/v-1");
  assert.equal(calls[0]!.method, "DELETE");
});

test("updateEnabledTools() PATCHes /admin/agents/:id/tools", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  await client.updateEnabledTools("agent-1", { enabled_tools: ["search"] });
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/tools");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { enabled_tools: ["search"] });
});

test("updateEnabledMcpServers() PATCHes /admin/agents/:id/mcp-servers", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  await client.updateEnabledMcpServers("agent-1", {
    enabled_mcp_servers: ["mcp-1"],
  });
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/mcp-servers");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, { enabled_mcp_servers: ["mcp-1"] });
});

test("updateToolDescriptionOverrides() PATCHes /admin/agents/:id/tool-descriptions", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  await client.updateToolDescriptionOverrides("agent-1", {
    tool_description_overrides: { search: "custom description" },
  });
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/tool-descriptions");
  assert.equal(calls[0]!.method, "PATCH");
  assert.deepEqual(calls[0]!.body, {
    tool_description_overrides: { search: "custom description" },
  });
});

test("list() converts limit/offset pagination into limit/offset query params against the { agents, total } envelope", async () => {
  const allAgents = Array.from({ length: 5 }, (_, i) => ({
    ...sampleAgent,
    id: `agent-${i}`,
  }));
  const { transport, calls } = fakeTransport((call) => {
    const url = new URL(`http://x${call.path}`);
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const agents = allAgents.slice(offset, offset + limit);
    return { status: 200, body: { agents, total: allAgents.length } };
  });
  const client = createAgentsClient({ transport });

  const seen: unknown[] = [];
  for await (const agent of client.list({ pageSize: 2 })) {
    seen.push(agent);
  }

  assert.deepEqual(seen, allAgents);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.path, "/admin/agents?limit=2&offset=0");
  assert.equal(calls[1]!.path, "/admin/agents?limit=2&offset=2");
  assert.equal(calls[2]!.path, "/admin/agents?limit=2&offset=4");
});

test("list() forwards status and is_active filters", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: { agents: [], total: 0 },
  }));
  const client = createAgentsClient({ transport });

  await client.list({ status: "published", is_active: true }).page();

  assert.ok(calls[0]!.path.includes("status=published"));
  assert.ok(calls[0]!.path.includes("is_active=true"));
});

test("list().page() returns a single page without iterating further", async () => {
  const { transport } = fakeTransport(() => ({
    status: 200,
    body: { agents: [sampleAgent], total: 1 },
  }));
  const client = createAgentsClient({ transport });

  const page = await client.list().page();
  assert.deepEqual(page.items, [sampleAgent]);
  assert.equal(page.total, 1);
  assert.equal(page.hasMore, false);
});

test("revert() POSTs /admin/agents/:id/revert and returns the reverted agent", async () => {
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: sampleAgent,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.revert("agent-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/admin/agents/agent-1/revert");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, sampleAgent);
});

test("listMemoryProposals() GETs /admin/agents/memory-proposals", async () => {
  const proposals = {
    proposals: [
      {
        id: "prop-1",
        kind: "fact",
        title: "example",
        status: "PROPOSED",
      },
    ],
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: proposals,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.listMemoryProposals();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/admin/agents/memory-proposals");
  assert.equal(calls[0]!.method, "GET");
  assert.deepEqual(result, proposals);
});

test("approveMemoryProposal() POSTs /admin/agents/memory-proposals/:id/approve", async () => {
  const actionResult = {
    success: true,
    proposal: { id: "prop-1", status: "APPROVED" },
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: actionResult,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.approveMemoryProposal("prop-1");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]!.path,
    "/admin/agents/memory-proposals/prop-1/approve"
  );
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, actionResult);
});

test("rejectMemoryProposal() POSTs /admin/agents/memory-proposals/:id/reject", async () => {
  const actionResult = {
    success: true,
    proposal: { id: "prop-1", status: "REJECTED" },
  };
  const { transport, calls } = fakeTransport(() => ({
    status: 200,
    body: actionResult,
  }));
  const client = createAgentsClient({ transport });

  const result = await client.rejectMemoryProposal("prop-1");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]!.path,
    "/admin/agents/memory-proposals/prop-1/reject"
  );
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(result, actionResult);
});
