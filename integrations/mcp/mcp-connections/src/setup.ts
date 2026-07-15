/**
 * mcp-connections sample provisioning — demonstrates the MCP Connections
 * feature (DOCS/architecture/mcp-connections.md) end to end through
 * `@yoizen/platform-sdk`'s `mcpServers`, `agents`, and `workflows` resources.
 *
 * Provisions, in order:
 *   1. An MCP server with a typed auth config (`authType: "bearer"`) pointed
 *      at a fake/example endpoint — this sample's job is to demonstrate the
 *      SDK call shapes, not to reach a real MCP server.
 *   2. A live connectivity probe (`testConnection(id)`) — expected to fail
 *      or time out against the fake endpoint; logged as a warning, not a
 *      hard failure (same non-fatal handling `ai-agent-triage`'s Telegram
 *      discovery uses for best-effort external calls).
 *   3. Live tool discovery (`listTools(id)`) — same non-fatal handling; the
 *      fake endpoint will not return real tools.
 *   4. A demo agent, with a hardcoded subset of (hypothetical) MCP tools
 *      enabled per-agent via `updateEnabledMcpTools` (mcp-connections.md
 *      §4), plus one tool-description override via
 *      `updateToolDescriptionOverrides`. NOTE: per-tool filtering is gated
 *      server-side by the `AGENT_MCP_TOOL_FILTERING_ENABLED` feature flag
 *      (default off) — this call is expected to succeed and persist
 *      regardless of the flag; the flag only affects whether
 *      `agent-ai-service` actually applies the filter at runtime.
 *   5. A minimal workflow with one `mcpCall` action, using the strongly
 *      typed `McpCallAction` helper from `@yoizen/platform-sdk/workflows`
 *      (mcp-connections.md §5). Kept intentionally small — no trigger, one
 *      action — since this sample's job is showing the SDK call shape, not
 *      building workflow scaffolding.
 *
 * The script is a true IDEMPOTENT UPSERT (safe to re-run): the MCP server
 * and the agent are both resolved-by-name and reused if present. RECREATE=1
 * deletes this sample's own MCP server + agent + workflow (by name) first,
 * then re-provisions from scratch. Same env var / idempotency conventions
 * as ../../http/http-connectors/src/setup.ts. Invoked by `setup.sh` after
 * `../lib/resolve-env.sh` has resolved the environment. Login itself is
 * handled transparently by createClient()/the SDK session on first request
 * — no explicit login stage needed here (see http-bridge/src/setup.ts, same
 * convention: stage numbering skips the login step).
 */
import { createClient } from "@yoizen/platform-sdk";
import type { Agent, CreateAgentInput } from "@yoizen/platform-sdk/agents";
import type {
  CreateMcpServerInput,
  McpServer,
} from "@yoizen/platform-sdk/mcp-servers";
import type {
  CreateWorkflowInput,
  McpCallAction,
  Workflow,
} from "@yoizen/platform-sdk/workflows";

// ----- Pretty logging (verbose; nothing fails silently) ---------------------
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";
const log = (msg: string) => console.log(`${GREEN}[INFO]${NC}  ${msg}`);
const step = (msg: string) => console.log(`${BLUE}[STEP]${NC}  ${msg}`);
const warn = (msg: string) => console.log(`${YELLOW}[WARN]${NC}  ${msg}`);
const err = (msg: string) => console.error(`${RED}[ERR]${NC}   ${msg}`);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function fail(message: string): never {
  err(message);
  process.exit(1);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh). Only
// script-specific vars are read here.

const MCP_SERVER_NAME = process.env.MCP_SERVER_NAME ?? "sample-mcp-server";
// Fake/example endpoint — intentionally not expected to be reachable. This
// sample demonstrates the SDK call shapes (create/testConnection/listTools),
// not a real live MCP integration.
const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL ?? "https://mcp.example.com/mcp";
const MCP_SERVER_DESCRIPTION =
  process.env.MCP_SERVER_DESCRIPTION ??
  "Example MCP server created by integrations/mcp/mcp-connections (fake endpoint, demonstrates auth/test/tools/agent-wiring call shapes)";
// authConfig's shape depends on authType (see mcp-servers/types.ts): `{ token }`
// for "bearer", `{ headerName?, key }` for "api-key", `{ username, password }`
// for "basic". This sample uses bearer.
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "sample-bearer-token";

// Hypothetical tool names — the fake endpoint won't return a real tools/list,
// so these are hardcoded to demonstrate the per-tool enablement call shape
// (mcp-connections.md §4) even without a live discovery result.
const SAMPLE_TOOL_NAMES = (process.env.MCP_SAMPLE_TOOLS ?? "search,lookup")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DESCRIPTION_OVERRIDE_TOOL = SAMPLE_TOOL_NAMES[0] ?? "search";
const DESCRIPTION_OVERRIDE_TEXT =
  process.env.MCP_TOOL_DESCRIPTION_OVERRIDE ??
  "Searches the sample MCP server's index. Prefer this over any built-in search tool for this agent.";

const AGENT_NAME = process.env.MCP_AGENT_NAME ?? "mcp-connections-demo-agent";
const AGENT_DESCRIPTION =
  process.env.MCP_AGENT_DESCRIPTION ??
  "Demo agent wired to a subset of an MCP server's tools, created by integrations/mcp/mcp-connections";

const WORKFLOW_NAME = process.env.MCP_WORKFLOW_NAME ?? "mcp-connections-demo";
const APPLICATION = process.env.MCP_APPLICATION ?? "samples";

const RECREATE = process.env.RECREATE ?? "0";

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see ../lib/resolve-env.sh);
// the SDK's fetch-based transport needs it passed as a regular header since
// we're talking to a bare IP/localhost port.
const fetchWithHostHeader: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (hostHeader) {
    headers.set("Host", hostHeader);
  }
  return fetch(input, { ...init, headers });
};

const client = createClient({
  tenant,
  email,
  password,
  baseUrl,
  fetch: hostHeader ? fetchWithHostHeader : undefined,
});

let mcpServerId = "";
let agentId = "";
let workflowId = "";

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/6 preflight");
  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  mcpServer=${MCP_SERVER_NAME}  agent=${AGENT_NAME}  recreate=${RECREATE}`
  );
  log(`mcp server url (fake, likely unreachable): ${MCP_SERVER_URL}`);
  log(
    `hypothetical tools to enable per-agent: ${SAMPLE_TOOL_NAMES.join(", ")}`
  );
}

// ----- Stage recreate (optional): wipe this sample's own artifacts ----------
async function resolveMcpServerIdByName(name: string): Promise<string> {
  for await (const server of client.mcpServers.list()) {
    if (server.name === name) {
      return server.id;
    }
  }
  return "";
}

async function resolveAgentIdByName(name: string): Promise<string> {
  for await (const agent of client.agents.list()) {
    if (agent.name === name && agent.is_active !== false) {
      return agent.id;
    }
  }
  return "";
}

async function resolveWorkflowIdByName(name: string): Promise<string> {
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === name) {
      return workflow.id;
    }
  }
  return "";
}

async function stageRecreate(): Promise<void> {
  if (RECREATE !== "1") {
    return;
  }
  step("recreate — deleting this sample's own mcp server / agent / workflow");

  const existingWorkflowId = await resolveWorkflowIdByName(WORKFLOW_NAME);
  if (existingWorkflowId) {
    log(`  deleting workflow ${existingWorkflowId}`);
    await client.workflows.remove(existingWorkflowId).catch(() => undefined);
  }

  const existingAgentId = await resolveAgentIdByName(AGENT_NAME);
  if (existingAgentId) {
    log(`  deleting agent ${existingAgentId}`);
    await client.agents.remove(existingAgentId).catch(() => undefined);
  }

  const existingMcpServerId = await resolveMcpServerIdByName(MCP_SERVER_NAME);
  if (existingMcpServerId) {
    log(`  deleting mcp server ${existingMcpServerId}`);
    await client.mcpServers.remove(existingMcpServerId).catch(() => undefined);
  }

  log("recreate done — provisioning will recreate from scratch");
}

// ----- Stage 2: upsert the MCP server ----------------------------------------
function buildMcpServerPayload(): CreateMcpServerInput {
  return {
    name: MCP_SERVER_NAME,
    description: MCP_SERVER_DESCRIPTION,
    transport_type: "http",
    url: MCP_SERVER_URL,
    authType: "bearer",
    authConfig: { token: MCP_AUTH_TOKEN },
    enabled: true,
  };
}

async function stageUpsertMcpServer(): Promise<void> {
  step(`2/6 upsert MCP server '${MCP_SERVER_NAME}'`);

  const existingId = await resolveMcpServerIdByName(MCP_SERVER_NAME);
  const body = buildMcpServerPayload();

  let server: McpServer | undefined;
  if (existingId) {
    server = await client.mcpServers.update(existingId, body).catch((e) => {
      fail(`MCP server update failed: ${messageOf(e)}`);
    });
    if (!server?.id) {
      fail(`MCP server update failed: ${JSON.stringify(server)}`);
    }
    mcpServerId = server.id;
    log(`reused/updated mcp server id=${mcpServerId}`);
  } else {
    server = await client.mcpServers.create(body).catch((e) => {
      fail(`MCP server creation failed: ${messageOf(e)}`);
    });
    if (!server?.id) {
      fail(`MCP server creation failed: ${JSON.stringify(server)}`);
    }
    mcpServerId = server.id;
    log(`created mcp server id=${mcpServerId} (auth=bearer, transport=http)`);
  }
}

// ----- Stage 3: test connection (best-effort — fake endpoint) --------------
async function stageTestConnection(): Promise<void> {
  step(`3/6 test connection for mcp server ${mcpServerId}`);

  try {
    const result = await client.mcpServers.testConnection(mcpServerId);
    if (result.success) {
      log(
        `connection ok — latencyMs=${result.latencyMs}${
          result.toolCount !== undefined ? ` toolCount=${result.toolCount}` : ""
        }`
      );
    } else {
      warn(
        `connection reported failure (expected — fake endpoint): ${result.error ?? "no error detail"} (latencyMs=${result.latencyMs})`
      );
    }
  } catch (e) {
    warn(
      `testConnection call itself failed (expected — fake endpoint unreachable): ${messageOf(e)}`
    );
  }
}

// ----- Stage 4: discover tools (best-effort — fake endpoint) ---------------
async function stageListTools(): Promise<void> {
  step(`4/6 discover tools for mcp server ${mcpServerId}`);

  try {
    const tools = await client.mcpServers.listTools(mcpServerId);
    if (tools.length === 0) {
      warn(
        "no tools discovered (expected — fake endpoint has no real tools/list)"
      );
    } else {
      log(`discovered ${tools.length} tool(s):`);
      for (const tool of tools) {
        log(`  - ${tool.name}: ${tool.description ?? "(no description)"}`);
      }
    }
  } catch (e) {
    warn(
      `listTools call itself failed (expected — fake endpoint unreachable): ${messageOf(e)}`
    );
  }
}

// ----- Stage 5: upsert the demo agent + per-tool MCP enablement -------------
function buildAgentPayload(): CreateAgentInput {
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    system_prompt:
      "You are a demo assistant wired to a subset of an MCP server's tools. Use the enabled tools when relevant to the user's request.",
    model_config: {},
    tools: [],
    channels: [],
  };
}

async function stageUpsertAgent(): Promise<void> {
  step(`5/6 upsert agent '${AGENT_NAME}' + per-tool MCP enablement`);

  const existingId = await resolveAgentIdByName(AGENT_NAME);
  const body = buildAgentPayload();

  let agent: Agent | undefined;
  if (existingId) {
    agent = await client.agents.update(existingId, body).catch((e) => {
      fail(`Agent update failed: ${messageOf(e)}`);
    });
    if (!agent?.id) {
      fail(`Agent update failed: ${JSON.stringify(agent)}`);
    }
    agentId = agent.id;
    log(`reused/updated agent id=${agentId}`);
  } else {
    agent = await client.agents.create(body).catch((e) => {
      fail(`Agent creation failed: ${messageOf(e)}`);
    });
    if (!agent?.id) {
      fail(`Agent creation failed: ${JSON.stringify(agent)}`);
    }
    agentId = agent.id;
    log(`created agent id=${agentId}`);
  }

  // enabled_mcp_tools is keyed by MCP server NAME (not id), per
  // mcp-connections.md §4 / agents/types.ts's Agent.enabled_mcp_tools doc
  // comment. `null` for a server means "all tools enabled"; here we pass an
  // explicit allowlist for this one server. NOTE: server-side, applying this
  // filter at runtime is gated by the AGENT_MCP_TOOL_FILTERING_ENABLED
  // feature flag (default off) — the write itself is expected to succeed and
  // persist regardless.
  await client.agents
    .updateEnabledMcpTools(agentId, {
      enabled_mcp_tools: { [MCP_SERVER_NAME]: SAMPLE_TOOL_NAMES },
    })
    .catch((e) => {
      fail(`updateEnabledMcpTools failed: ${messageOf(e)}`);
    });
  log(
    `enabled tools [${SAMPLE_TOOL_NAMES.join(", ")}] for mcp server '${MCP_SERVER_NAME}' on agent ${agentId}`
  );

  // tool_description_overrides accepts "<serverName>:<toolName>" keys for MCP
  // tools (mcp-connections.md §4.3) alongside its existing plain-name keys
  // for adapter/builtin tools.
  // This endpoint is gated server-side: agent-admin-service rejects it with
  // 400 unless AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED=true is set on that
  // service. A disabled flag is a valid platform state, so treat that as a
  // skip, not a failure.
  const overrideKey = `${MCP_SERVER_NAME}:${DESCRIPTION_OVERRIDE_TOOL}`;
  try {
    await client.agents.updateToolDescriptionOverrides(agentId, {
      tool_description_overrides: { [overrideKey]: DESCRIPTION_OVERRIDE_TEXT },
    });
    log(`set description override for '${overrideKey}'`);
  } catch (e) {
    warn(
      `description override skipped (requires AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED=true on agent-admin-service): ${messageOf(e)}`
    );
  }
}

// ----- Stage 6: minimal workflow with one mcpCall action --------------------
// The `McpCallAction` helper type is used only via `satisfies` for
// compile-time checking of the action's shape; the action itself is built as
// an object literal so it structurally satisfies the looser `WorkflowAction`
// (which carries an open index signature — see workflows/types.ts) the same
// way every other action literal in this codebase does (see
// ai-agent-triage/src/setup.ts's `notifyActionsFor`).
function buildWorkflowBody(): CreateWorkflowInput {
  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "callMcpTool",
        activity: "mcpCall",
        args: {
          serverId: mcpServerId,
          toolName: DESCRIPTION_OVERRIDE_TOOL,
          params: {},
        },
      } satisfies McpCallAction,
    ],
  };
}

async function stageEnsureWorkflow(): Promise<void> {
  step(`6/6 ensure minimal workflow '${WORKFLOW_NAME}' with an mcpCall action`);

  const allWorkflows: Workflow[] = [];
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === WORKFLOW_NAME) {
      allWorkflows.push(workflow);
    }
  }
  // API returns oldest-first; reverse so newest is first.
  const matching = allWorkflows.reverse();
  const keep = matching[0];
  const stale = matching.slice(1);

  for (const workflow of stale) {
    log(`  removing duplicate workflow ${workflow.id}`);
    await client.workflows.remove(workflow.id).catch(() => undefined);
  }

  if (keep) {
    // Full-replace update (PUT) so re-running always reflects the current
    // mcpServerId/tool name, same as ai-agent-triage's workflow upsert.
    const updated = await client.workflows
      .update(keep.id, buildWorkflowBody())
      .catch((e) => {
        fail(`Workflow update failed: ${messageOf(e)}`);
      });
    if (!updated?.id) {
      fail(`Workflow update failed: ${JSON.stringify(updated)}`);
    }
    workflowId = updated.id;
    log(`reused/updated workflow id=${workflowId}`);
    return;
  }

  const created = await client.workflows
    .create(buildWorkflowBody())
    .catch((e) => {
      fail(`Workflow creation failed: ${messageOf(e)}`);
    });
  if (!created?.id) {
    fail(`Workflow creation failed: ${JSON.stringify(created)}`);
  }
  workflowId = created.id;
  log(`created workflow id=${workflowId}`);
}

// ----- Summary ---------------------------------------------------------------
function stageSummary(): void {
  console.log();
  log("Done. Provisioned:");
  log(`  mcp server : '${MCP_SERVER_NAME}' (${mcpServerId}) — authType=bearer`);
  log(`  agent      : '${AGENT_NAME}' (${agentId})`);
  log(
    `               enabled_mcp_tools['${MCP_SERVER_NAME}'] = [${SAMPLE_TOOL_NAMES.join(", ")}]`
  );
  log(
    `               tool_description_overrides['${MCP_SERVER_NAME}:${DESCRIPTION_OVERRIDE_TOOL}'] set`
  );
  log(`  workflow   : '${WORKFLOW_NAME}' (${workflowId}) — one mcpCall action`);
  console.log();
  log(
    "This sample does not execute the workflow or agent — the mcp server url is fake/unreachable by design. See README.md for what each SDK call demonstrates."
  );
}

export async function provisionMcpConnections(): Promise<void> {
  stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageRecreate();
  await stageUpsertMcpServer();
  await stageTestConnection();
  await stageListTools();
  await stageUpsertAgent();
  await stageEnsureWorkflow();
  stageSummary();
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  provisionMcpConnections().catch((e) => {
    err(`failed: ${messageOf(e)}`);
    process.exit(1);
  });
}
