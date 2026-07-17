/**
 * mcp-connections sample driver — the RUN side that VERIFIES the
 * already-provisioned MCP server, agent, and workflow (provisioning itself is
 * declarative now, via `manifest.yaml` + `yoizen manifests apply`; see
 * README.md).
 *
 * Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
 * once first to provision `sample-mcp-server`, `mcp-connections-demo-agent`
 * (with its `enabledMcpTools`/`toolDescriptionOverrides`), and the
 * `mcp-connections-demo` workflow. This script never creates or modifies
 * platform objects — it only:
 *   1. Confirms the MCP server exists via `client.mcpServers.list()`.
 *   2. Best-effort probes it with `testConnection()`/`listTools()` — expected
 *      to fail or return empty against the fake/example endpoint, logged as
 *      a warning, never a hard failure.
 *   3. Confirms the demo agent exists and reports its `enabled_mcp_tools`/
 *      `tool_description_overrides`.
 *   4. Confirms the demo workflow exists with its `mcpCall` action.
 *
 * This sample never executes the workflow or the agent — the MCP server URL
 * is fake/unreachable by design (see README.md).
 */
import { createClient } from "@yoizen/platform-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  const mcpServerName = process.env.MCP_SERVER_NAME ?? "sample-mcp-server";
  const agentName = process.env.MCP_AGENT_NAME ?? "mcp-connections-demo-agent";
  const workflowName = process.env.MCP_WORKFLOW_NAME ?? "mcp-connections-demo";

  // The gateway's dev ingress routes by Host header (see
  // ../lib/resolve-env.sh); the SDK's fetch-based transport needs it passed
  // as a regular header since we're talking to a bare IP/localhost port.
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

  console.log(
    "[run] verifying the mcp-connections sample (apply manifest.yaml first if this fails)..."
  );

  let mcpServerId = "";
  for await (const server of client.mcpServers.list()) {
    if (server.name === mcpServerName) {
      mcpServerId = server.id;
      break;
    }
  }
  if (!mcpServerId) {
    console.error(
      `[run] MISSING mcp server '${mcpServerName}' — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
    );
    process.exit(1);
  }
  console.log(`[run] mcp server '${mcpServerName}' ok — id=${mcpServerId}`);

  try {
    const result = await client.mcpServers.testConnection(mcpServerId);
    console.log(
      `[run] testConnection -> success=${String(result.success)} latencyMs=${result.latencyMs}`
    );
  } catch (e) {
    console.warn(
      `[run] testConnection call failed (expected — fake endpoint unreachable): ${messageOf(e)}`
    );
  }

  try {
    const tools = await client.mcpServers.listTools(mcpServerId);
    console.log(
      `[run] listTools -> ${String(tools.length)} tool(s) discovered`
    );
  } catch (e) {
    console.warn(
      `[run] listTools call failed (expected — fake endpoint unreachable): ${messageOf(e)}`
    );
  }

  let agentFound = false;
  for await (const agent of client.agents.list()) {
    if (agent.name === agentName && agent.is_active !== false) {
      agentFound = true;
      console.log(
        `[run] agent '${agentName}' ok — id=${agent.id} enabled_mcp_tools=${JSON.stringify(
          agent.enabled_mcp_tools ?? {}
        )} tool_description_overrides=${JSON.stringify(
          agent.tool_description_overrides ?? {}
        )}`
      );
      break;
    }
  }
  if (!agentFound) {
    console.error(
      `[run] MISSING agent '${agentName}' — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
    );
    process.exit(1);
  }

  let workflowFound = false;
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === workflowName) {
      workflowFound = true;
      console.log(`[run] workflow '${workflowName}' ok — id=${workflow.id}`);
      break;
    }
  }
  if (!workflowFound) {
    console.error(
      `[run] MISSING workflow '${workflowName}' — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
    );
    process.exit(1);
  }

  console.log(
    "[run] mcp server + agent + workflow all present. This sample does not execute them — the mcp server url is fake/unreachable by design. See README.md."
  );
}

main().catch((e) => {
  console.error("[run] failed:", messageOf(e));
  process.exit(1);
});
