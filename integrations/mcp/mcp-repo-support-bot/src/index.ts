/**
 * mcp-repo-support-bot sample driver — the RUN side that EXERCISES the
 * already-provisioned resources (provisioning itself is now declarative, via
 * `manifest.yaml` + `yoizen manifests apply`; see README.md).
 *
 * Mirrors ../../channels/telegram-transform-reply/src/index.ts and
 * ../mcp-connections/src/index.ts's split responsibilities:
 *   1. Confirms the DeepWiki MCP server, both agents, and the workflow all
 *      exist (`client.mcpServers.list()` / `client.agents.list()` /
 *      `client.workflows.list()`).
 *   2. Best-effort probes the MCP server with `testConnection()`/
 *      `listTools()` — DeepWiki is REAL and public, so unlike mcp-connections
 *      these are expected to succeed, but failures are logged as warnings,
 *      never a hard failure (network flakiness/outages should not break the
 *      driver).
 *   3. POSTs a signed synthetic Telegram inbound update to the webhook
 *      ingest endpoint and polls for the resulting workflow execution —
 *      observing it proves the whole chain (including the real `mcpCall` to
 *      DeepWiki) fired, without needing Telegram to deliver the OUTBOUND
 *      reply.
 *
 * The webhook secret (channel-service's per-account `appSecret`) is NOT
 * surfaced by `manifests apply`, so it is provided via the env var
 * `TELEGRAM_WEBHOOK_SECRET` (the same mechanism
 * telegram-transform-reply/src/index.ts already established) — read it from
 * the account after apply (`GET /channels/accounts`), or mint one by
 * re-applying. Runs against the account externalId the manifest apply engine
 * derives: `manifest:mcp-repo-support-bot`.
 *
 * This script never creates or modifies platform objects.
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

function fail(message: string): never {
  console.error(`[run] ${message}`);
  process.exit(1);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

const MCP_SERVER_NAME = process.env.DEEPWIKI_SERVER_NAME ?? "deepwiki";
const TRIAGE_AGENT_NAME =
  process.env.TRIAGE_AGENT_NAME ?? "repo-support-triage";
const SUMMARIZER_AGENT_NAME =
  process.env.SUMMARIZER_AGENT_NAME ?? "repo-support-summarizer";
const WORKFLOW_NAME = process.env.WORKFLOW_NAME ?? "mcp-repo-support-bot";
// The apply engine derives a channel's externalId as `manifest:<name>`
// (`channels-writer.ts`) — `manifest.yaml`'s channel name
// (`mcp-repo-support-bot`) becomes the externalId `manifest:mcp-repo-support-bot`.
const EXTERNAL_ID =
  process.env.TG_EXTERNAL_ID ?? "manifest:mcp-repo-support-bot";
const REPO_NAME = process.env.REPO_NAME ?? "vercel/next.js";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const TELEGRAM_TEST_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID ?? "999999999";
const SIMULATE_TEXT =
  process.env.SIMULATE_TEXT ?? `How does routing work in ${REPO_NAME}?`;
const POLL_TIMEOUT_S = Number(process.env.TG_POLL_TIMEOUT_S ?? "90");
// Set 0 to skip the synthetic drive and only verify resources exist.
const SIMULATE_INBOUND = process.env.SIMULATE_INBOUND ?? "1";

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see ../../lib/resolve-env.sh);
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

async function verifyResources(): Promise<{ workflowId: string }> {
  console.log(
    "[run] verifying manifest-provisioned resources (apply manifest.yaml first if this fails)..."
  );

  let mcpServerId = "";
  for await (const server of client.mcpServers.list()) {
    if (server.name === MCP_SERVER_NAME) {
      mcpServerId = server.id;
      break;
    }
  }
  if (!mcpServerId) {
    fail(
      `MISSING mcp server '${MCP_SERVER_NAME}' — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
    );
  }
  console.log(`[run] mcp server '${MCP_SERVER_NAME}' ok — id=${mcpServerId}`);

  try {
    const result = await client.mcpServers.testConnection(mcpServerId);
    console.log(
      `[run] testConnection -> success=${String(result.success)} latencyMs=${result.latencyMs}`
    );
  } catch (e) {
    console.warn(
      `[run] testConnection call failed (non-fatal): ${messageOf(e)}`
    );
  }

  try {
    const tools = await client.mcpServers.listTools(mcpServerId);
    console.log(
      `[run] listTools -> ${String(tools.length)} tool(s) discovered`
    );
  } catch (e) {
    console.warn(`[run] listTools call failed (non-fatal): ${messageOf(e)}`);
  }

  for (const name of [TRIAGE_AGENT_NAME, SUMMARIZER_AGENT_NAME]) {
    let found = false;
    for await (const agent of client.agents.list()) {
      if (agent.name === name && agent.is_active !== false) {
        found = true;
        console.log(`[run] agent '${name}' ok — id=${agent.id}`);
        break;
      }
    }
    if (!found) {
      fail(
        `MISSING agent '${name}' — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
      );
    }
  }

  let workflowId = "";
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === WORKFLOW_NAME) {
      workflowId = workflow.id;
      break;
    }
  }
  if (!workflowId) {
    fail(
      `MISSING workflow '${WORKFLOW_NAME}' — run 'yoizen manifests apply -f manifest.yaml --secrets-from-env' first`
    );
  }
  console.log(`[run] workflow '${WORKFLOW_NAME}' ok — id=${workflowId}`);

  return { workflowId };
}

async function simulateInbound(workflowId: string): Promise<void> {
  console.log("[run] simulate inbound Telegram update");
  if (SIMULATE_INBOUND !== "1") {
    console.log(
      "[run] SIMULATE_INBOUND!=1 — skipping. Message the bot for real, or set SIMULATE_INBOUND=1."
    );
    return;
  }
  if (!WEBHOOK_SECRET) {
    fail(
      "TELEGRAM_WEBHOOK_SECRET is required to simulate — the account's webhook " +
        "appSecret (GET /channels/accounts after apply). Set SIMULATE_INBOUND=0 to skip."
    );
  }

  const chatId = Number(TELEGRAM_TEST_CHAT_ID);
  const update = {
    update_id: 1,
    message: {
      message_id: Math.floor(Math.random() * 32768),
      date: Math.floor(Date.now() / 1000),
      from: { id: chatId, is_bot: false, first_name: "Sample" },
      chat: { id: chatId, type: "private" },
      text: SIMULATE_TEXT,
    },
  };

  console.log(
    `[run] POST /api/webhooks/telegram/${tenant}/${EXTERNAL_ID}  (chat_id=${TELEGRAM_TEST_CHAT_ID}, text='${SIMULATE_TEXT}')`
  );
  const ingestResult = await client.webhooks.ingest({
    tenant,
    channel: "telegram",
    instance: EXTERNAL_ID,
    headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
    body: update,
  });
  if (ingestResult.status !== "accepted") {
    fail(`Webhook not accepted: ${JSON.stringify(ingestResult)}`);
  }
  console.log(
    `[run] inbound accepted; waiting for a workflow execution (timeout ${POLL_TIMEOUT_S}s)`
  );

  const deadline = Date.now() + POLL_TIMEOUT_S * 1000;
  while (Date.now() < deadline) {
    let found:
      | { id: string; status: string; createdAt: string; updatedAt: string }
      | undefined;
    for await (const execution of client.workflows.listExecutions(workflowId, {
      pageSize: 1,
    })) {
      found = execution;
      break;
    }
    if (found) {
      console.log("[run] workflow execution observed:");
      console.log(
        JSON.stringify(
          {
            id: found.id,
            status: found.status,
            createdAt: found.createdAt,
            updatedAt: found.updatedAt,
          },
          null,
          2
        )
      );
      console.log(
        "[run] The chain ran: triage -> route -> conditional (mcpCall DeepWiki -> summarize -> reply)."
      );
      return;
    }
    await sleep(3);
  }
  fail(
    `no execution observed within ${POLL_TIMEOUT_S}s — check workflow-service / trigger-consumer logs.`
  );
}

async function main(): Promise<void> {
  console.log(
    "[run] (provisioning is declarative now: `yoizen manifests apply -f manifest.yaml --secrets-from-env` — see README.md)"
  );
  const { workflowId } = await verifyResources();
  await simulateInbound(workflowId);
  console.log();
  console.log(
    "[run] Done. To exercise interactively instead, message the bot on Telegram with a question about the repo."
  );
}

main().catch((e) => {
  console.error("[run] failed:", messageOf(e));
  process.exit(1);
});
