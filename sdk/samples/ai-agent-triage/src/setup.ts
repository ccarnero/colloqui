/**
 * ai-agent-triage sample provisioning — SDK-powered replacement for the old
 * curl+jq `setup.sh` body.
 *
 * Provisions (in order): an LLM connector (unless AI_CREDENTIAL_MODE=env), a
 * published triage agent, a dedicated HTTP channel account, and a workflow
 * wiring `agentCall` (triage) -> `jsFunction` (route) -> `conditional`
 * (notify) through `@yoizen/platform-sdk`'s `connectors`, `agents`,
 * `channels`, and `workflows` resources. Telegram chat_id discovery talks
 * directly to `api.telegram.org` (getWebhookInfo / deleteWebhook /
 * getUpdates / setWebhook) — that's raw Telegram Bot API, not part of our
 * platform SDK, so it stays as plain `fetch()` calls (same pattern as
 * ../http-bridge/src/setup.ts).
 *
 * Same env vars, defaults, idempotency/dedup/RECREATE semantics, and final
 * summary output as the bash version this replaces. Invoked by `setup.sh`
 * after `../lib/resolve-env.sh` has resolved the environment.
 */
import * as readline from "node:readline";
import { createClient } from "@yoizen/platform-sdk";
import type { Agent, CreateAgentInput } from "@yoizen/platform-sdk/agents";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type { Workflow, WorkflowAction } from "@yoizen/platform-sdk/workflows";

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

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh).
// Only script-specific vars are read here.

const WORKFLOW_NAME = process.env.TRIAGE_WORKFLOW_NAME ?? "ai-agent-triage";
const APPLICATION = process.env.TRIAGE_APPLICATION ?? "samples";

// --- AI agent + LLM connector (same knobs as ai-agent-playground) -----------
const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-triage";
const AGENT_DESCRIPTION =
  process.env.AI_AGENT_DESCRIPTION ??
  "Call-center triage classifier created by sdk/samples/ai-agent-triage";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

// --- Telegram recipients ------------------------------------------------------
// Auto-discovered if left unset (setup fetches the bot's own token from the
// platform and calls Telegram's getUpdates). If a SECOND chat id is pinned or
// discovered, notify becomes a parallel branch with one channelSend arm per
// chat (channelSend.to is a single string). TG_ACCOUNT_ID pins a specific
// Telegram channel account; otherwise the first active one is used.
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
let TELEGRAM_CHAT_ID_2 = process.env.TELEGRAM_CHAT_ID_2 ?? "";
let TG_ACCOUNT_ID = process.env.TG_ACCOUNT_ID ?? "";

// Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
// path segment of the per-instance ingress URL
// (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
// pinned to this account's id (accountIds) so ONLY messages to this instance
// fire it — no cross-firing with other http workflows.
const HTTP_EXTERNAL_ID =
  process.env.TRIAGE_HTTP_EXTERNAL_ID ?? "ai-agent-triage";
const HTTP_ACCOUNT_NAME =
  process.env.TRIAGE_HTTP_ACCOUNT_NAME ?? "AI Agent Triage";

// Pin the trigger to the dedicated http instance via accountIds. ON by
// default; set TRIAGE_PIN=0 to let ANY http message trigger the workflow.
const TRIAGE_PIN = process.env.TRIAGE_PIN ?? "1";

// Defaults to always rebuild the HTTP instance + workflow: the workflow body
// embeds the agent id and chat id(s) resolved on THIS run, so reuse-by-name
// would mask changes. Connector + agent are upserted in place regardless.
// Set RECREATE=0 to reuse the existing instance/workflow by name.
const RECREATE = process.env.RECREATE ?? "1";

const TRIAGE_DISCOVER_WAIT_SECONDS = Number(
  process.env.TRIAGE_DISCOVER_WAIT_SECONDS ?? "60"
);
const TRIAGE_DISCOVER_POLL_INTERVAL = Number(
  process.env.TRIAGE_DISCOVER_POLL_INTERVAL ?? "2"
);
const TRIAGE_RESTORE_WEBHOOK = process.env.TRIAGE_RESTORE_WEBHOOK ?? "1";

// System prompt for the triage agent: reply ONLY with compact JSON so the
// `route` jsFunction can parse it deterministically.
const TRIAGE_SYSTEM_PROMPT = `You are a call-center triage classifier. For every customer message you receive, reply ONLY with a compact single-line JSON object and nothing else — no prose, no markdown, no code fences. The object must have exactly these keys:
{"intent": "<short intent label, e.g. refund, shipping, complaint, question>", "sentiment": "positive|neutral|negative", "priority": "low|normal|high|urgent", "summary": "<one short sentence summarizing the customer's message>"}
Rules: sentiment and priority MUST be one of the listed values. Angry or threatening messages are negative and at least high priority. If the message is empty or meaningless, use intent "unknown", sentiment "neutral", priority "low".`;

// The route step. Safely parses the agent's JSON reply from
// results.triage.data.reply (agentCall returns { status, data: { reply,
// tool_calls } } — see agent-call.activity.ts), stripping markdown code
// fences if the LLM adds them, and falls back to a neutral classification if
// parsing fails. Parse-only: the actual routing decision is taken by the
// downstream `notify` conditional gateway, which compares
// results.route.escalate against "true" (the engine's condition resolver
// reads raw context paths and String()-compares, so a boolean matches "true"
// — see resolvePathRaw/compare in temporal/workflows.ts). A conditional
// CANNOT parse the JSON string itself: IConditionRule.variable is a dot-path
// walked over objects, which is why this jsFunction must exist at all.
const ROUTE_CODE = `(ctx) => {
  var req = ctx.request || {};
  var triage = (ctx.results && ctx.results.triage) || {};
  var raw = (triage.data && typeof triage.data.reply === "string")
    ? triage.data.reply
    : "";

  var cleaned = raw.trim();
  var fence = cleaned.match(/^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/);
  if (fence) cleaned = fence[1].trim();

  var parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = {
      intent: "unknown",
      sentiment: "neutral",
      priority: "high", // fail safe: an unparseable triage is escalated
      summary: raw ? ("unparseable agent reply: " + raw.slice(0, 160)) : "agent returned no reply"
    };
  }

  var priority = parsed.priority || "normal";
  var sentiment = parsed.sentiment || "neutral";
  var escalate = priority === "urgent" || priority === "high" || sentiment === "negative";

  var detail =
    "priority: " + priority +
    " | sentiment: " + sentiment +
    " | intent: " + (parsed.intent || "unknown") + "\\n" +
    (parsed.summary || "(no summary)") + "\\n" +
    "Original: " + (req.text || "(empty)");

  return {
    escalate: escalate,
    priority: priority,
    sentiment: sentiment,
    alertText: "🚨 ESCALATION — " + detail,
    normalText: "✅ Triage — " + detail
  };
}`;

// ----- LLM provider helpers (same contract as ai-agent-playground) ----------
function providerApiKeyVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "cohere":
      return "COHERE_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "ollama":
      return "OLLAMA_API_KEY";
    default:
      return "";
  }
}

function providerBaseUrlVar(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "ANTHROPIC_BASE_URL";
    case "groq":
      return "GROQ_BASE_URL";
    case "mistral":
      return "MISTRAL_BASE_URL";
    case "openai":
      return "OPENAI_BASE_URL";
    case "ollama":
      return "OLLAMA_BASE_URL";
    case "openrouter":
      return "OPENROUTER_BASE_URL";
    case "xai":
      return "XAI_BASE_URL";
    default:
      return "";
  }
}

function providerDefaultBaseUrl(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "cohere":
      return "https://api.cohere.com/v2";
    case "deepseek":
      return "https://api.deepseek.com";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "ollama":
      return "http://localhost:11434/v1";
    default:
      return "";
  }
}

function readEnvValue(key: string): string {
  if (!key) {
    return "";
  }
  return process.env[key] ?? "";
}

function isPlaceholderSecret(value: string): boolean {
  return (
    value === "sk-..." ||
    value.includes("your-") ||
    value.includes("replace-me") ||
    value.includes("example")
  );
}

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

let connectorId = "";
let agentId = "";
let httpAccountId = "";
let httpAppSecret = "";
let workflowId = "";

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/5 preflight");

  if (CREDENTIAL_MODE !== "connector" && CREDENTIAL_MODE !== "env") {
    fail("AI_CREDENTIAL_MODE must be 'connector' or 'env'");
  }

  const keyVar = providerApiKeyVar(AGENT_PROVIDER);
  const keyValue = readEnvValue(keyVar);

  if (CREDENTIAL_MODE === "connector") {
    if (!keyVar) {
      fail(
        `Unsupported provider '${AGENT_PROVIDER}'. Choose openai, anthropic, google, groq, mistral, cohere, openrouter, xai, ollama, or deepseek.`
      );
    }
    if (!keyValue && AGENT_PROVIDER !== "ollama") {
      fail(
        `${keyVar} is required for AI_CREDENTIAL_MODE=connector. Put it in .env next to setup.sh.`
      );
    }
    if (keyValue && isPlaceholderSecret(keyValue)) {
      fail(
        `${keyVar} looks like a placeholder. Replace it with a real provider key.`
      );
    }
    log(
      `credential mode=connector provider=${AGENT_PROVIDER} model=${AGENT_MODEL} connector=${LLM_CONNECTOR_NAME}`
    );
  } else {
    warn(
      `credential mode=env: this script cannot inject ${keyVar || "provider API key"} into the running agent-ai-service.`
    );
    warn(
      "Make sure the service deployment already has the provider env var before executing."
    );
    log(`provider=${AGENT_PROVIDER} model=${AGENT_MODEL}`);
  }

  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  workflow=${WORKFLOW_NAME}  agent=${AGENT_NAME}  recreate=${RECREATE}`
  );
  if (TELEGRAM_CHAT_ID) {
    log(
      `telegram chat_id(s) preset: ${TELEGRAM_CHAT_ID}${
        TELEGRAM_CHAT_ID_2 ? `, ${TELEGRAM_CHAT_ID_2}` : ""
      }`
    );
  } else {
    log(
      "TELEGRAM_CHAT_ID not set — will auto-discover from the bot's recent /start messages"
    );
  }
}

// ----- Stage 2: ensure LLM connector -----------------------------------------
async function resolveConnectorIdByName(name: string): Promise<string> {
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    if (connector.name === name) {
      return connector.id;
    }
  }
  return "";
}

async function stageEnsureLlmConnector(): Promise<void> {
  if (CREDENTIAL_MODE !== "connector") {
    step("2/5 skip LLM connector (credential mode=env)");
    return;
  }
  step(`2/5 ensure LLM connector '${LLM_CONNECTOR_NAME}'`);

  const keyVar = providerApiKeyVar(AGENT_PROVIDER);
  const baseVar = providerBaseUrlVar(AGENT_PROVIDER);
  const apiKey = readEnvValue(keyVar);
  const providerBaseUrl =
    readEnvValue(baseVar) || providerDefaultBaseUrl(AGENT_PROVIDER);

  connectorId = await resolveConnectorIdByName(LLM_CONNECTOR_NAME);

  if (!connectorId) {
    const created: Connector | undefined = await client.connectors
      .create({
        name: LLM_CONNECTOR_NAME,
        context: "external",
        baseUrl: providerBaseUrl,
        authType: "bearer",
        authConfig: { bearerToken: apiKey },
        timeoutMs: 60000,
        maxRetries: 1,
        retryBackoffMs: 500,
        tags: ["llm"],
        endpoints: [],
      })
      .catch((e) => {
        fail(
          `LLM connector creation failed: ${e instanceof Error ? e.message : e}`
        );
      });
    if (!created?.id) {
      fail(`LLM connector creation failed: ${JSON.stringify(created)}`);
    }
    connectorId = created.id;
    log(`created connector id=${connectorId} baseUrl=${providerBaseUrl}`);
  } else {
    log(`reusing connector id=${connectorId}`);
    await client.connectors
      .update(connectorId, {
        baseUrl: providerBaseUrl,
        authType: "bearer",
        authConfig: { bearerToken: apiKey },
        timeoutMs: 60000,
        maxRetries: 1,
        retryBackoffMs: 500,
        tags: ["llm"],
      })
      .catch((e) => {
        warn(
          `connector update returned: ${e instanceof Error ? e.message : e}`
        );
      });
  }
}

// ----- Stage 3: upsert + publish the triage agent ----------------------------
async function resolveAgentIdByName(name: string): Promise<string> {
  for await (const agent of client.agents.list()) {
    if (agent.name === name && agent.is_active !== false) {
      return agent.id;
    }
  }
  return "";
}

// Low temperature + small maxTokens: the agent's only job is a compact,
// deterministic JSON classification — no creativity, no long outputs.
function buildAgentPayload(): CreateAgentInput {
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    system_prompt: TRIAGE_SYSTEM_PROMPT,
    model_config: {
      llm: {
        provider: AGENT_PROVIDER,
        model: AGENT_MODEL,
        connectorId: CREDENTIAL_MODE === "connector" ? connectorId : null,
        temperature: 0.1,
        maxTokens: 200,
      },
      rules:
        "Reply ONLY with the compact JSON object. Never add prose, markdown, or code fences.",
      soul: "Precise, terse, deterministic.",
      subagents: [],
    },
    tools: [],
    channels: [],
  };
}

async function stageUpsertAgent(): Promise<void> {
  step(`3/5 upsert + publish agent '${AGENT_NAME}'`);

  const existingId = await resolveAgentIdByName(AGENT_NAME);
  const body = buildAgentPayload();

  let agent: Agent | undefined;
  if (existingId) {
    agent = await client.agents.update(existingId, body).catch((e) => {
      fail(`Agent update failed: ${e instanceof Error ? e.message : e}`);
    });
    if (!agent?.id) {
      fail(`Agent update failed: ${JSON.stringify(agent)}`);
    }
    agentId = agent.id;
    log(`updated agent id=${agentId}`);
  } else {
    agent = await client.agents.create(body).catch((e) => {
      fail(`Agent creation failed: ${e instanceof Error ? e.message : e}`);
    });
    if (!agent?.id) {
      fail(`Agent creation failed: ${JSON.stringify(agent)}`);
    }
    agentId = agent.id;
    log(`created agent id=${agentId}`);
  }

  const published = await client.agents.publish(agentId).catch((e) => {
    fail(`Agent publish failed: ${e instanceof Error ? e.message : e}`);
  });
  if (!published?.id) {
    fail(`Agent publish failed: ${JSON.stringify(published)}`);
  }
  log(`published agent id=${agentId}`);
}

// ensureHttpAccount — resolve (or create) the sample's dedicated HTTP channel
// instance, identified by externalId. Captures httpAccountId + httpAppSecret
// (the gateway returns appSecret in the list, plaintext). Deduplicates on
// every run.
async function ensureHttpAccount(): Promise<void> {
  const accounts: ChannelAccount[] = [];
  for await (const account of client.channels.listAccounts({
    channel: "http",
  })) {
    accounts.push(account);
  }

  // Collect ALL exact-externalId-matching active accounts, newest first
  // (the API returns them oldest-first, so reverse).
  const matching = accounts
    .filter((a) => a.externalId === HTTP_EXTERNAL_ID && a.isActive)
    .reverse();

  const keep = matching[0];
  const stale = matching.slice(1);

  // Always dedup: keep newest, delete the rest on every run.
  for (const account of stale) {
    log(`removing duplicate HTTP instance ${account.id}`);
    await client.channels.removeAccount(account.id).catch(() => undefined);
  }

  // Reuse the survivor unless RECREATE=1.
  if (keep && RECREATE !== "1") {
    httpAccountId = keep.id;
    httpAppSecret = keep.appSecret ?? "";
    log(
      `reusing HTTP instance ${httpAccountId} (externalId=${HTTP_EXTERNAL_ID})`
    );
    return;
  }

  // RECREATE=1 or no existing account: delete survivor if any, then create
  // fresh.
  if (keep) {
    log(`RECREATE=1 — removing HTTP instance ${keep.id}`);
    await client.channels.removeAccount(keep.id).catch(() => undefined);
  }

  const created = await client.channels
    .createAccount({
      channel: "http",
      provider: "http",
      name: HTTP_ACCOUNT_NAME,
      externalId: HTTP_EXTERNAL_ID,
      accessToken: "http-ingest",
      isActive: true,
    })
    .catch((e) => {
      fail(
        `HTTP instance creation failed: ${e instanceof Error ? e.message : e}`
      );
    });

  if (!created?.id) {
    fail(`HTTP instance creation failed: ${JSON.stringify(created)}`);
  }
  httpAccountId = created.id;
  httpAppSecret = created.appSecret ?? "";
  log(
    `created HTTP instance ${httpAccountId} (externalId=${HTTP_EXTERNAL_ID})`
  );
}

// ----- Telegram chat_id discovery (raw Telegram Bot API, not SDK-covered) ---

interface TelegramChat {
  id: string;
  label: string;
  date: number;
}

// fetchTelegramChats <botToken> — one getUpdates call, returns one row per
// distinct chat, most recent message first. Empty output means "no updates
// available right now" (caller decides whether to retry); warns only on a
// hard Telegram API error.
async function fetchTelegramChats(botToken: string): Promise<TelegramChat[]> {
  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates`
  );
  const updates = (await resp.json()) as {
    ok?: boolean;
    description?: string;
    result?: Array<{
      message?: {
        chat?: { id?: number; username?: string; first_name?: string };
        date?: number;
      };
    }>;
  };
  if (!updates.ok) {
    warn(
      `Telegram getUpdates failed: ${updates.description ?? JSON.stringify(updates)}`
    );
    return [];
  }

  const byId = new Map<string, TelegramChat>();
  for (const item of updates.result ?? []) {
    const chat = item.message?.chat;
    if (!chat || chat.id == null) {
      continue;
    }
    const id = String(chat.id);
    const date = item.message?.date ?? 0;
    const existing = byId.get(id);
    if (!existing || date > existing.date) {
      byId.set(id, {
        id,
        label: chat.username ?? chat.first_name ?? "unknown",
        date,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.date - a.date);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// promptOrWait — interactive shells get a blocking "press Enter" prompt
// capped by waitSeconds (so it can't hang forever); non-interactive shells
// just sleep that same duration.
async function promptOrWait(waitSeconds: number): Promise<void> {
  if (!process.stdin.isTTY) {
    log(`non-interactive shell — waiting ${waitSeconds}s instead of prompting`);
    await sleep(waitSeconds);
    return;
  }
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const timer = setTimeout(() => {
      rl.close();
      resolve();
    }, waitSeconds * 1000);
    rl.question(
      `  press Enter once you have sent it (auto-continues after ${waitSeconds}s)... `,
      () => {
        clearTimeout(timer);
        rl.close();
        resolve();
      }
    );
  });
}

// discoverChatIds <botToken> — only runs when TELEGRAM_CHAT_ID is unset:
// discovery clears/restores the bot's webhook, which briefly interrupts live
// delivery, so a preset TELEGRAM_CHAT_ID means the second recipient stays
// opt-in (TELEGRAM_CHAT_ID_2). Calls Telegram's getUpdates with the bot's OWN
// token (fetched from the platform, see stageResolve) to find everyone who
// has /start-ed it, then auto-fills TELEGRAM_CHAT_ID / TELEGRAM_CHAT_ID_2.
//
// getUpdates and an active webhook are mutually exclusive on the SAME bot
// token (Telegram returns 409 "Conflict"), and telegram-transform-reply
// registers one. So: capture the current webhook (getWebhookInfo), clear it
// (deleteWebhook) to unblock polling, then restore the exact same URL
// afterward — TRIAGE_RESTORE_WEBHOOK=0 skips the restore if you'd rather
// leave the bot in polling mode.
//
// IMPORTANT: updates already pushed through an active webhook are consumed —
// Telegram does NOT replay them via getUpdates once the webhook is cleared,
// not even ones sent BEFORE this run started. So if a webhook was active, any
// /start sent earlier is unrecoverable; only messages sent AFTER the webhook
// drops will show up.
async function discoverChatIds(botToken: string): Promise<void> {
  if (TELEGRAM_CHAT_ID) {
    return;
  }
  if (!botToken || botToken.startsWith("PLACEHOLDER:")) {
    warn(
      "telegram account has no real bot token — cannot auto-discover chat_ids"
    );
    return;
  }

  const webhookInfoResp = await fetch(
    `https://api.telegram.org/bot${botToken}/getWebhookInfo`
  );
  const webhookInfo = (await webhookInfoResp.json()) as {
    result?: { url?: string };
  };
  const webhookUrl = webhookInfo.result?.url ?? "";

  if (webhookUrl) {
    log(`clearing active webhook (${webhookUrl}) so getUpdates can poll`);
    await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
  }

  let chats: TelegramChat[] = [];
  if (webhookUrl) {
    warn(
      "the webhook was already delivering — any /start sent BEFORE this point is gone and will NOT be found"
    );
    log("send /start (or any message) to the bot NOW, after this line printed");
    await promptOrWait(TRIAGE_DISCOVER_WAIT_SECONDS);

    // Telegram can lag a moment before a just-sent message shows up in
    // getUpdates; retry a handful of times rather than a single shot.
    for (let attempt = 0; attempt < 5; attempt++) {
      chats = await fetchTelegramChats(botToken);
      if (chats.length > 0) {
        break;
      }
      await sleep(TRIAGE_DISCOVER_POLL_INTERVAL);
    }
  } else {
    chats = await fetchTelegramChats(botToken);
  }

  if (chats.length === 0) {
    warn("no Telegram chats found — send /start to the bot, then re-run");
  } else {
    log("discovered telegram chats (most recent first):");
    for (const chat of chats) {
      log(`  chat_id=${chat.id}  (${chat.label})`);
    }

    if (!TELEGRAM_CHAT_ID) {
      TELEGRAM_CHAT_ID = chats[0].id;
      log(
        `auto-selected TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID} (most recent chat)`
      );
    }
    if (!TELEGRAM_CHAT_ID_2) {
      const next = chats.find((c) => c.id !== TELEGRAM_CHAT_ID);
      if (next) {
        TELEGRAM_CHAT_ID_2 = next.id;
        log(
          `auto-selected TELEGRAM_CHAT_ID_2=${TELEGRAM_CHAT_ID_2} (next most recent distinct chat)`
        );
      }
    }
  }

  if (webhookUrl) {
    if (TRIAGE_RESTORE_WEBHOOK === "1") {
      log(`restoring webhook -> ${webhookUrl}`);
      await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
    } else {
      warn(
        "TRIAGE_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh or set it again manually when done polling"
      );
    }
  }
}

// ----- Stage 4: resolve dependency ids (telegram account + http instance) --
async function stageResolve(): Promise<void> {
  step("4/5 resolve telegram account + http instance");

  const tgAccounts: ChannelAccount[] = [];
  for await (const account of client.channels.listAccounts({
    channel: "telegram",
  })) {
    tgAccounts.push(account);
  }

  if (!TG_ACCOUNT_ID) {
    TG_ACCOUNT_ID = tgAccounts.find((a) => a.isActive)?.id ?? "";
  }
  if (!TG_ACCOUNT_ID) {
    err("no active Telegram channel account found.");
    err(
      "Provision one first:  (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)"
    );
    err("or pin one with TG_ACCOUNT_ID=<id>.");
    process.exit(1);
  }
  log(`telegram account=${TG_ACCOUNT_ID}`);

  const tgBotToken =
    tgAccounts.find((a) => a.id === TG_ACCOUNT_ID)?.accessToken ?? "";
  await discoverChatIds(tgBotToken);

  if (!TELEGRAM_CHAT_ID) {
    err("TELEGRAM_CHAT_ID is required and could not be auto-discovered.");
    err("DM your bot first, then re-run — or set TELEGRAM_CHAT_ID manually.");
    process.exit(1);
  }
  log(
    `telegram chat_id(s)=${TELEGRAM_CHAT_ID}${
      TELEGRAM_CHAT_ID_2 ? `, ${TELEGRAM_CHAT_ID_2}` : ""
    }`
  );

  await ensureHttpAccount();
}

// notifyActionsFor <namePrefix> <textTemplate> — emit the action(s) that
// deliver one text to the configured recipient(s). channelSend.to only
// accepts a single string, so two recipients need a branch with one
// channelSend arm per chat_id (http-bridge pattern). Used for both arms of
// the `notify` conditional gateway below.
function notifyActionsFor(
  prefix: string,
  textTemplate: string
): WorkflowAction[] {
  const notifyArgs = {
    accountId: TG_ACCOUNT_ID,
    channel: "telegram",
    provider: "telegram",
    type: "text",
    text: textTemplate,
  };

  if (TELEGRAM_CHAT_ID_2 && TELEGRAM_CHAT_ID_2 !== TELEGRAM_CHAT_ID) {
    return [
      {
        name: `${prefix}Fanout`,
        activity: "branch",
        recipientA: [
          {
            name: `${prefix}Primary`,
            activity: "channelSend",
            args: { ...notifyArgs, to: TELEGRAM_CHAT_ID },
          },
        ],
        recipientB: [
          {
            name: `${prefix}Secondary`,
            activity: "channelSend",
            args: { ...notifyArgs, to: TELEGRAM_CHAT_ID_2 },
          },
        ],
      },
    ];
  }

  return [
    {
      name: `${prefix}Send`,
      activity: "channelSend",
      args: { ...notifyArgs, to: TELEGRAM_CHAT_ID },
    },
  ];
}

// buildWorkflowBody — assemble the workflow definition with resolved ids.
//
// agentCall args (AgentCallArgs, packages/shared/src/workflow.interfaces.ts):
// agentId + message are required; conversationId/userId/channel are optional
// metadata forwarded to the agent runtime. NOTE: args.variables would be
// OVERWRITTEN by the workflow's own execution-context variables at run time
// (see executeAction case "agentCall" in temporal/workflows.ts), so it is not
// set here — everything the agent needs travels in `message`.
function buildWorkflowBody() {
  // Exclusive gateway (ConditionalAction, workflow.interfaces.ts): branches
  // are evaluated top-to-bottom, first match wins, `default` runs when none
  // match. The condition reads results.route.escalate (a boolean) — the
  // engine resolves the path raw and compares String(left) === String(right),
  // so value "true" matches. The result exposes { matchedBranch }.
  const notifyAction = {
    name: "notify",
    activity: "conditional",
    branches: [
      {
        label: "Escalate",
        condition: {
          variable: "results.route.escalate",
          comparator: "eq",
          value: "true",
        },
        actions: notifyActionsFor("alert", "{{results.route.alertText}}"),
      },
    ],
    default: notifyActionsFor("resolve", "{{results.route.normalText}}"),
  };

  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "triage",
        activity: "agentCall",
        args: {
          agentId,
          message: "{{request.text}}",
          conversationId: "ai-agent-triage",
          userId: "{{request.from}}",
          channel: "http",
        },
      },
      {
        name: "route",
        activity: "jsFunction",
        args: { code: ROUTE_CODE },
      },
      notifyAction,
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["http"],
        providers: ["http"],
        ...(TRIAGE_PIN === "1" ? { accountIds: [httpAccountId] } : {}),
      },
    },
  };
}

// ----- Stage 5: ensure the workflow ------------------------------------------
async function stageEnsureWorkflow(): Promise<void> {
  step(`5/5 ensure workflow '${WORKFLOW_NAME}'`);

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

  // Always dedup: delete extras on every run, not just on recreate.
  for (const workflow of stale) {
    log(`removing duplicate workflow ${workflow.id}`);
    await client.workflows.remove(workflow.id).catch(() => undefined);
  }

  if (keep && RECREATE !== "1") {
    workflowId = keep.id;
    log(`reusing existing workflow ${workflowId} (set RECREATE=1 to rebuild)`);
    return;
  }
  if (keep) {
    log(`RECREATE=1 — deleting workflow ${keep.id}`);
    await client.workflows.remove(keep.id).catch(() => undefined);
  }

  const body = buildWorkflowBody();
  const created = await client.workflows.create(body).catch((e) => {
    fail(`Workflow creation failed: ${e instanceof Error ? e.message : e}`);
  });
  if (!created?.id) {
    fail(`Workflow creation failed: ${JSON.stringify(created)}`);
  }
  workflowId = created.id;
  log(`created workflow id=${workflowId}`);
}

async function main(): Promise<void> {
  stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageEnsureLlmConnector();
  await stageUpsertAgent();
  await stageResolve();
  await stageEnsureWorkflow();

  const ingestUrl = `${baseUrl}/api/webhooks/http/${tenant}/${HTTP_EXTERNAL_ID}`;

  console.log();
  log(`Done. Workflow '${WORKFLOW_NAME}' (${workflowId}):`);
  log(
    `  trigger : message_received on channels=[http], pinned to accountIds=[${httpAccountId}]`
  );
  log(
    `  triage  : agentCall -> agent '${AGENT_NAME}' (${agentId}), replies compact JSON classification`
  );
  log(
    "  route   : jsFunction parses results.triage.data.reply (fail-safe fallback), derives escalate verdict"
  );
  if (TELEGRAM_CHAT_ID_2 && TELEGRAM_CHAT_ID_2 !== TELEGRAM_CHAT_ID) {
    log(
      `  notify  : conditional gateway on results.route.escalate — 🚨 alert / ✅ summary -> chats ${TELEGRAM_CHAT_ID}, ${TELEGRAM_CHAT_ID_2}`
    );
  } else {
    log(
      `  notify  : conditional gateway on results.route.escalate — 🚨 alert / ✅ summary -> chat ${TELEGRAM_CHAT_ID}`
    );
  }
  log(
    `  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)`
  );
  console.log();
  log("Drive it — POST a customer message to THIS instance's own URL:");
  log(`    curl -X POST '${ingestUrl}' \\`);
  if (httpAppSecret) {
    log(`      -H 'x-http-channel-token: ${httpAppSecret}' \\`);
  } else {
    log(
      "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
    );
  }
  log("      -H 'content-type: application/json' \\");
  log(
    `      -d '{"from":"customer-42","text":"I want my money back RIGHT NOW, this is the third time my order is broken"}'`
  );
  log(
    "Or just run ./run.sh, which resolves the token and posts sample customer messages for you."
  );
  log(
    "Then check Telegram — the bot DMs you the triage summary (intent/sentiment/priority + summary)."
  );
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
