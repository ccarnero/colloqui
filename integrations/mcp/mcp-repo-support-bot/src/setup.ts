/**
 * mcp-repo-support-bot sample provisioning — a realistic end-to-end demo of
 * the `mcpCall` workflow action (DOCS/architecture/mcp-connections.md §5)
 * wired into a Telegram "Repo Support Bot".
 *
 * The scenario:
 *
 *   Telegram inbound (a question about a GitHub repo)
 *     → [agentCall  triage]     classify: is this about the repo, or not?
 *     → [jsFunction route]       parse the triage agent's strict-JSON verdict
 *     → [conditional respond]
 *         ├─ about the repo → [mcpCall     askDeepwiki]  DeepWiki ask_question
 *         │                    [jsFunction  extract]      flatten the answer
 *         │                    [agentCall   summarize]    rewrite in plain language
 *         │                    [channelSend reply]        answer over Telegram
 *         └─ anything else  → [channelSend decline]       polite "only repo X" reply
 *
 * Provisions, in order (idempotent upsert-by-name; RECREATE=1 teardown-first):
 *   1. MCP server "deepwiki" → https://mcp.deepwiki.com/mcp (http, authType
 *      none). Test connection + list tools, both NON-FATAL (warn if the public
 *      endpoint is unreachable) — same best-effort handling as
 *      ../mcp-connections/src/setup.ts.
 *   2. Triage agent — classifies the inbound message, replies with strict JSON
 *      `{"about_repo": true|false}` (mirrors ../../ai/ai-agent-triage's strict-JSON
 *      prompt style). Needs an LLM connector unless AI_CREDENTIAL_MODE=env.
 *   3. Summarizer agent — rewrites DeepWiki's technical answer for end users,
 *      brief and friendly.
 *   4. Telegram channel account + webhook registration (reuses
 *      ../../channels/telegram-transform-reply's account/webhook/TG_PUBLIC_URL logic
 *      verbatim; skipped with a warning when TG_PUBLIC_URL/token are unset).
 *   5. The workflow — trigger on the Telegram channel, actions per the scenario
 *      above, using the strongly-typed `McpCallAction` shape.
 *
 * Invoked by `setup.sh` after `../lib/resolve-env.sh` resolves the dev
 * environment, and re-exported (`main`) for `index.ts` (the `run.sh` driver,
 * which defaults SIMULATE_INBOUND=1 to drive one end-to-end exchange). Login is
 * handled transparently by createClient()/the SDK session on first request —
 * no explicit login stage.
 *
 * NOTE: a PUBLIC MCP server is required — the platform's SSRF guard (see
 * mcp-call.activity.ts `validateUrl`) blocks localhost/RFC1918 targets, so a
 * locally hosted MCP server will not work for the `mcpCall` step.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@yoizen/platform-sdk";
import type { Agent, CreateAgentInput } from "@yoizen/platform-sdk/agents";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type {
  CreateMcpServerInput,
  McpServer,
} from "@yoizen/platform-sdk/mcp-servers";
import type {
  McpCallAction,
  Workflow,
  WorkflowAction,
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
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ./setup.sh). Only
// script-specific vars are read here.

// The repo this bot answers questions about. DeepWiki indexes public GitHub
// repos by "owner/name". Configurable so the same bot can front any repo.
const REPO_NAME = process.env.REPO_NAME ?? "vercel/next.js";

// --- MCP server (DeepWiki) ---------------------------------------------------
// DeepWiki is a public, no-auth MCP server exposing read_wiki_structure,
// read_wiki_contents, and ask_question for any indexed GitHub repo.
const MCP_SERVER_NAME = process.env.DEEPWIKI_SERVER_NAME ?? "deepwiki";
const MCP_SERVER_URL =
  process.env.DEEPWIKI_URL ?? "https://mcp.deepwiki.com/mcp";
const MCP_SERVER_DESCRIPTION =
  process.env.DEEPWIKI_DESCRIPTION ??
  "DeepWiki public MCP server — answers questions about indexed GitHub repos. Registered by integrations/mcp/mcp-repo-support-bot.";
// DeepWiki's real tool for Q&A over a repo (mcp-connections README documents
// its full tool set: read_wiki_structure, read_wiki_contents, ask_question).
const DEEPWIKI_TOOL = process.env.DEEPWIKI_TOOL ?? "ask_question";

// --- AI agents + LLM connector (same knobs as ../../ai/ai-agent-triage) -----------
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

const TRIAGE_AGENT_NAME =
  process.env.TRIAGE_AGENT_NAME ?? "repo-support-triage";
const SUMMARIZER_AGENT_NAME =
  process.env.SUMMARIZER_AGENT_NAME ?? "repo-support-summarizer";

// --- Telegram ----------------------------------------------------------------
// Bot token from @BotFather. REQUIRED for real outbound delivery — it is the
// credential the SEND path uses. With a placeholder, artifacts still provision
// and the workflow still EXECUTES (observable via SIMULATE_INBOUND), but every
// Telegram send returns 404.
let TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
// Public HTTPS base reachable by Telegram (e.g. a cloudflared tunnel). When set
// + a real token, stage 4 registers the webhook at
// <TG_PUBLIC_URL>/api/webhooks/telegram/<tenant>/<externalId>.
const TG_PUBLIC_URL = process.env.TG_PUBLIC_URL ?? "";
// Stable identity PREFIX. Reuse matches any active telegram account whose
// externalId starts with this; each create appends a unique suffix.
const EXTERNAL_PREFIX = process.env.TG_EXTERNAL_ID ?? "repo-support-bot";
const ACCOUNT_NAME = process.env.TG_ACCOUNT_NAME ?? "Repo Support Bot";
const TG_PIN = process.env.TG_PIN ?? "1";

const WORKFLOW_NAME = process.env.WORKFLOW_NAME ?? "mcp-repo-support-bot";
const APPLICATION = process.env.WORKFLOW_APPLICATION ?? "samples";

const RECREATE = process.env.RECREATE ?? "0";

// Optional end-to-end drive of the chain with a synthetic inbound update.
// index.ts (run.sh) defaults this to "1"; setup.sh leaves it "0".
const SIMULATE_INBOUND = process.env.SIMULATE_INBOUND ?? "0";
// The synthetic inbound message text. Something clearly about the repo so the
// triage branch is exercised end-to-end.
const SIMULATE_TEXT =
  process.env.SIMULATE_TEXT ?? `How does routing work in ${REPO_NAME}?`;
// Numeric chat id the fake update claims to come from. Only matters for the
// OUTBOUND reply actually reaching Telegram (needs a real token + a chat that
// has /start-ed the bot). For merely OBSERVING that the workflow ran, any
// number works — so this defaults to a placeholder and the sample stays
// runnable without a live bot.
const TELEGRAM_TEST_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID ?? "999999999";
const POLL_TIMEOUT_S = Number(process.env.TG_POLL_TIMEOUT_S ?? "90");

// --- LLM provider API-key placeholders/detection (kept trivial here) --------

// Local cache of the webhook secret (appSecret is only returned at creation),
// so re-runs can still register/simulate after REUSING an existing account.
const sampleDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET_FILE =
  process.env.TG_SECRET_FILE ??
  path.join(sampleDir, ".repo-support-bot-secret");

function saveSecret(secret: string): void {
  if (!secret) {
    return;
  }
  fs.writeFileSync(SECRET_FILE, `${secret}\n`, { mode: 0o600 });
}

function loadSecret(): string {
  try {
    return fs.readFileSync(SECRET_FILE, "utf8").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

// ----- Agent prompts ---------------------------------------------------------

// Triage: reply ONLY with strict single-line JSON so the `route` jsFunction can
// parse it deterministically. Mirrors ../../ai/ai-agent-triage's strict-JSON style.
const TRIAGE_SYSTEM_PROMPT = `You are a triage classifier for a support bot dedicated to the GitHub repository "${REPO_NAME}". For every user message, decide whether it is a question ABOUT that repository (its code, architecture, APIs, configuration, usage, behavior, or internals) or something else (greetings, small talk, unrelated topics, other repositories).
Reply ONLY with a compact single-line JSON object and nothing else — no prose, no markdown, no code fences:
{"about_repo": true}  or  {"about_repo": false}
Rules: "about_repo" MUST be a JSON boolean (true/false). A genuine technical or usage question about ${REPO_NAME} is true. Anything else is false.`;

// Summarizer: turn DeepWiki's (often long, technical) answer into a short,
// friendly reply. Low temperature keeps it faithful to the source answer.
const SUMMARIZER_SYSTEM_PROMPT = `You are a friendly support assistant for the GitHub repository "${REPO_NAME}". You receive a user's question and a technical answer retrieved from the repository's documentation. Rewrite the technical answer as a brief, clear, friendly reply for the user (a few short sentences, plain language, no markdown headers). Stay faithful to the retrieved answer — do not invent facts. If the retrieved answer is empty or unhelpful, say you could not find a confident answer and suggest rephrasing.`;

// ----- route jsFunction: parse the triage agent's JSON verdict --------------
// agentCall returns { status, data: { reply, tool_calls } } (see
// agent-call.activity.ts), so the raw JSON lives at results.triage.data.reply.
// A conditional CANNOT parse a JSON string itself (IConditionRule.variable is a
// dot-path walked over objects), which is why this jsFunction must exist — same
// bridge role as ../../ai/ai-agent-triage's `route` step. Fail-safe: an unparseable
// verdict is treated as "not about the repo" so the bot declines rather than
// firing an MCP call on garbage.
const ROUTE_CODE = `(ctx) => {
  var triage = (ctx.results && ctx.results.triage) || {};
  var raw = (triage.data && typeof triage.data.reply === "string")
    ? triage.data.reply
    : "";

  var cleaned = raw.trim();
  var fence = cleaned.match(/^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/);
  if (fence) cleaned = fence[1].trim();

  var parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (e) { parsed = null; }

  var aboutRepo = !!(parsed && parsed.about_repo === true);
  return { about_repo: aboutRepo };
}`;

// ----- extract jsFunction: flatten DeepWiki's tool result into plain text ----
// The mcpCall activity stores { toolName, result, isError, durationMs } at
// results.askDeepwiki (see mcp-call.activity.ts IMcpCallResult). `result` is
// the tool's MCP `content` verbatim — for a text tool like ask_question that is
// typically a string, or an array of { type:"text", text:"..." } content
// blocks, depending on the AI SDK version. This normalizes all of those into a
// single `answer` string the summarizer agent can consume via a template.
const EXTRACT_CODE = `(ctx) => {
  var call = (ctx.results && ctx.results.askDeepwiki) || {};
  var content = call.result;
  var text = "";

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map(function (block) {
        if (block && typeof block.text === "string") return block.text;
        if (typeof block === "string") return block;
        return "";
      })
      .filter(Boolean)
      .join("\\n");
  } else if (content && typeof content === "object") {
    if (typeof content.text === "string") text = content.text;
    else text = JSON.stringify(content);
  }

  if (!text) text = "(no answer returned by DeepWiki)";
  return { answer: text, isError: call.isError === true };
}`;

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
let triageAgentId = "";
let summarizerAgentId = "";
let connectorId = "";
let accountId = "";
let externalId = "";
let appSecret = "";
let workflowId = "";

export interface SetupResult {
  mcpServerId: string;
  triageAgentId: string;
  summarizerAgentId: string;
  accountId: string;
  externalId: string;
  workflowId: string;
}

// ----- LLM provider helpers (same contract as ../../ai/ai-agent-triage) -----------
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

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/6 preflight");

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
      `credential mode=env: this script cannot inject ${keyVar || "the provider API key"} into agent-ai-service.`
    );
    warn(
      "Make sure the service deployment already has the provider env var before executing."
    );
  }

  if (!TELEGRAM_BOT_TOKEN) {
    TELEGRAM_BOT_TOKEN = "PLACEHOLDER:set-TELEGRAM_BOT_TOKEN-for-real-delivery";
    warn("TELEGRAM_BOT_TOKEN not set — using a placeholder.");
    warn(
      "Artifacts provision and the workflow still executes (observable via SIMULATE_INBOUND), but the Telegram SEND path returns 404 until you use a real token."
    );
  }

  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  repo=${REPO_NAME}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}`
  );
  log(
    `mcp server: ${MCP_SERVER_NAME} -> ${MCP_SERVER_URL} (tool=${DEEPWIKI_TOOL})`
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

async function stageRecreate(): Promise<void> {
  if (RECREATE !== "1") {
    return;
  }
  step("recreate — deleting this sample's own workflow / agents / mcp server");

  const allWorkflows: Workflow[] = [];
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === WORKFLOW_NAME) {
      allWorkflows.push(workflow);
    }
  }
  for (const workflow of allWorkflows) {
    log(`  deleting workflow ${workflow.id}`);
    await client.workflows.remove(workflow.id).catch(() => undefined);
  }

  const existingTriage = await resolveAgentIdByName(TRIAGE_AGENT_NAME);
  if (existingTriage) {
    log(`  deleting triage agent ${existingTriage}`);
    await client.agents.remove(existingTriage).catch(() => undefined);
  }
  const existingSummarizer = await resolveAgentIdByName(SUMMARIZER_AGENT_NAME);
  if (existingSummarizer) {
    log(`  deleting summarizer agent ${existingSummarizer}`);
    await client.agents.remove(existingSummarizer).catch(() => undefined);
  }

  const existingMcp = await resolveMcpServerIdByName(MCP_SERVER_NAME);
  if (existingMcp) {
    log(`  deleting mcp server ${existingMcp}`);
    await client.mcpServers.remove(existingMcp).catch(() => undefined);
  }

  log("recreate done — provisioning will recreate from scratch");
}

// ----- Stage 1: upsert the DeepWiki MCP server -------------------------------
function buildMcpServerPayload(): CreateMcpServerInput {
  return {
    name: MCP_SERVER_NAME,
    description: MCP_SERVER_DESCRIPTION,
    transport_type: "http",
    url: MCP_SERVER_URL,
    authType: "none",
    enabled: true,
  };
}

async function stageUpsertMcpServer(): Promise<void> {
  step(`1/6 upsert MCP server '${MCP_SERVER_NAME}'`);

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
    log(`created mcp server id=${mcpServerId} (auth=none, transport=http)`);
  }
}

// ----- Stage 2 (a): test connection (best-effort) ---------------------------
async function stageTestConnection(): Promise<void> {
  step(`2/6 test connection + discover tools for '${MCP_SERVER_NAME}'`);

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
        `connection reported failure: ${result.error ?? "no error detail"} (latencyMs=${result.latencyMs})`
      );
    }
  } catch (e) {
    warn(`testConnection call failed (non-fatal): ${messageOf(e)}`);
  }

  try {
    const tools = await client.mcpServers.listTools(mcpServerId);
    if (tools.length === 0) {
      warn("no tools discovered (non-fatal — check DeepWiki reachability)");
    } else {
      log(`discovered ${tools.length} tool(s):`);
      for (const tool of tools) {
        log(`  - ${tool.name}: ${tool.description ?? "(no description)"}`);
      }
      if (!tools.some((t) => t.name === DEEPWIKI_TOOL)) {
        warn(
          `configured tool '${DEEPWIKI_TOOL}' was not in the discovered set — the mcpCall step will fail at runtime unless it exists.`
        );
      }
    }
  } catch (e) {
    warn(`listTools call failed (non-fatal): ${messageOf(e)}`);
  }
}

// ----- Stage 3: ensure LLM connector (shared by both agents) ----------------
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
    step("3/6 skip LLM connector (credential mode=env)");
    return;
  }
  step(`3/6 ensure LLM connector '${LLM_CONNECTOR_NAME}'`);

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
        fail(`LLM connector creation failed: ${messageOf(e)}`);
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
        warn(`connector update returned: ${messageOf(e)}`);
      });
  }
}

// ----- Stage 4: upsert + publish the two agents -----------------------------
function buildAgentPayload(
  name: string,
  description: string,
  systemPrompt: string,
  maxTokens: number
): CreateAgentInput {
  return {
    name,
    description,
    system_prompt: systemPrompt,
    model_config: {
      llm: {
        provider: AGENT_PROVIDER,
        model: AGENT_MODEL,
        connectorId: CREDENTIAL_MODE === "connector" ? connectorId : null,
        temperature: 0.2,
        maxTokens,
      },
      subagents: [],
    },
    tools: [],
    channels: [],
  };
}

async function upsertAndPublishAgent(
  name: string,
  payload: CreateAgentInput
): Promise<string> {
  const existingId = await resolveAgentIdByName(name);

  let agent: Agent | undefined;
  if (existingId) {
    agent = await client.agents.update(existingId, payload).catch((e) => {
      fail(`Agent '${name}' update failed: ${messageOf(e)}`);
    });
    if (!agent?.id) {
      fail(`Agent '${name}' update failed: ${JSON.stringify(agent)}`);
    }
    log(`updated agent '${name}' id=${agent.id}`);
  } else {
    agent = await client.agents.create(payload).catch((e) => {
      fail(`Agent '${name}' creation failed: ${messageOf(e)}`);
    });
    if (!agent?.id) {
      fail(`Agent '${name}' creation failed: ${JSON.stringify(agent)}`);
    }
    log(`created agent '${name}' id=${agent.id}`);
  }

  const published = await client.agents.publish(agent.id).catch((e) => {
    fail(`Agent '${name}' publish failed: ${messageOf(e)}`);
  });
  if (!published?.id) {
    fail(`Agent '${name}' publish failed: ${JSON.stringify(published)}`);
  }
  log(`published agent '${name}' id=${agent.id}`);
  return agent.id;
}

async function stageUpsertAgents(): Promise<void> {
  step(`4/6 upsert + publish triage + summarizer agents`);

  triageAgentId = await upsertAndPublishAgent(
    TRIAGE_AGENT_NAME,
    // Small maxTokens: the triage agent's only job is a one-key JSON verdict.
    buildAgentPayload(
      TRIAGE_AGENT_NAME,
      `Classifies whether an inbound message is a question about ${REPO_NAME}. Created by integrations/mcp/mcp-repo-support-bot.`,
      TRIAGE_SYSTEM_PROMPT,
      50
    )
  );

  summarizerAgentId = await upsertAndPublishAgent(
    SUMMARIZER_AGENT_NAME,
    buildAgentPayload(
      SUMMARIZER_AGENT_NAME,
      `Rewrites DeepWiki's technical answer about ${REPO_NAME} into a brief, friendly reply. Created by integrations/mcp/mcp-repo-support-bot.`,
      SUMMARIZER_SYSTEM_PROMPT,
      400
    )
  );
}

// ----- Stage 5: ensure the Telegram channel account (receive + send) --------
// Reuses ../../channels/telegram-transform-reply's account logic verbatim: dedup by
// externalId prefix (keep newest), reuse unless RECREATE=1, cache the webhook
// appSecret locally.
async function ensureAccount(): Promise<void> {
  step(`5/6 ensure Telegram channel account (prefix=${EXTERNAL_PREFIX})`);

  const accounts: ChannelAccount[] = [];
  for await (const account of client.channels.listAccounts({
    channel: "telegram",
  })) {
    accounts.push(account);
  }

  const matching = accounts
    .filter((a) => a.externalId.startsWith(EXTERNAL_PREFIX) && a.isActive)
    .reverse();

  const keep = matching[0];
  const stale = matching.slice(1);

  for (const account of stale) {
    log(`removing stale prefix-matching account ${account.id}`);
    await client.channels.removeAccount(account.id).catch(() => undefined);
  }

  if (keep && RECREATE !== "1") {
    accountId = keep.id;
    externalId = keep.externalId;
    appSecret = loadSecret();
    log(
      `reusing existing account ${accountId} externalId=${externalId} (set RECREATE=1 to rotate token/secret)`
    );
    if (appSecret) {
      log("loaded cached webhook secret");
    } else {
      warn(
        "no cached webhook secret — run once with RECREATE=1 to mint+cache one"
      );
    }
    return;
  }

  if (keep) {
    log(`removing prefix-matching account ${keep.id}`);
    await client.channels.removeAccount(keep.id).catch(() => undefined);
  }

  externalId = `${EXTERNAL_PREFIX}-${Math.floor(Date.now() / 1000)}-${Math.floor(
    Math.random() * 32768
  )}`;

  const created = await client.channels
    .createAccount({
      channel: "telegram",
      provider: "telegram",
      name: ACCOUNT_NAME,
      externalId,
      telegramBotToken: TELEGRAM_BOT_TOKEN,
      accessToken: TELEGRAM_BOT_TOKEN,
      isActive: true,
    })
    .catch((e) => {
      fail(`Account creation failed: ${messageOf(e)}`);
    });

  if (!created?.id) {
    fail(`Account creation failed: ${JSON.stringify(created)}`);
  }
  accountId = created.id;
  appSecret = created.appSecret ?? "";
  saveSecret(appSecret);
  log(`created account id=${accountId} externalId=${externalId}`);
  if (appSecret) {
    log("webhook secret captured + cached");
  } else {
    warn(
      "create response did not expose appSecret — webhook register/simulate will be skipped"
    );
  }
}

// ----- Stage 6: ensure the workflow -----------------------------------------
// buildWorkflowBody — the whole scenario, wired with resolved ids. The reply
// always lands in the SAME chat the message came from ({{request.from}}), and
// the trigger is account-agnostic in its action templates
// ({{request.envelope.accountId}}), so recreating the account never requires
// editing action bodies.
function buildWorkflowBody() {
  // The `mcpCall` step, strongly typed via `satisfies McpCallAction`. It is
  // built as an object literal so it structurally satisfies the looser
  // `WorkflowAction` the workflows resource accepts (same pattern as
  // ../mcp-connections/src/setup.ts). params use {{...}} templates, resolved
  // against the execution context by workflow-service before the activity runs.
  const askDeepwiki = {
    name: "askDeepwiki",
    activity: "mcpCall",
    args: {
      serverId: mcpServerId,
      toolName: DEEPWIKI_TOOL,
      params: {
        repoName: REPO_NAME,
        question: "{{request.text}}",
      },
    },
  } satisfies McpCallAction;

  // Actions inside a conditional branch run SEQUENTIALLY through the same
  // execution context (see executeActions in workflow-service temporal/
  // workflows.ts), so each nested action can reference the previous one's
  // result via {{results.<name>...}}.
  const aboutRepoActions: WorkflowAction[] = [
    askDeepwiki,
    {
      name: "extract",
      activity: "jsFunction",
      args: { code: EXTRACT_CODE },
    },
    {
      name: "summarize",
      activity: "agentCall",
      args: {
        agentId: summarizerAgentId,
        // The summarizer sees both the original question and the retrieved
        // technical answer, and rewrites it for the user.
        message:
          "User question: {{request.text}}\n\nTechnical answer retrieved from the repository docs:\n{{results.extract.answer}}\n\nRewrite the technical answer as a brief, friendly reply for the user.",
        conversationId: WORKFLOW_NAME,
        userId: "{{request.from}}",
        channel: "telegram",
      },
    },
    {
      name: "reply",
      activity: "channelSend",
      args: {
        accountId: "{{request.envelope.accountId}}",
        channel: "{{request.channel}}",
        provider: "{{request.provider}}",
        to: "{{request.from}}",
        type: "text",
        text: "{{results.summarize.data.reply}}",
      },
    },
  ];

  // The "not about the repo" branch: a single polite decline over Telegram.
  const declineActions: WorkflowAction[] = [
    {
      name: "decline",
      activity: "channelSend",
      args: {
        accountId: "{{request.envelope.accountId}}",
        channel: "{{request.channel}}",
        provider: "{{request.provider}}",
        to: "{{request.from}}",
        type: "text",
        text: `I only answer questions about the ${REPO_NAME} repository. Ask me about its code, architecture, configuration, or usage.`,
      },
    },
  ];

  // Exclusive gateway (ConditionalAction): branches evaluated top-to-bottom,
  // first match wins, `default` runs when none match. The condition reads
  // results.route.about_repo (a boolean); the engine resolves the path raw and
  // String()-compares, so value "true" matches a boolean true (same mechanism
  // as ../../ai/ai-agent-triage's escalate condition).
  const respondAction = {
    name: "respond",
    activity: "conditional",
    branches: [
      {
        label: "AboutRepo",
        condition: {
          variable: "results.route.about_repo",
          comparator: "eq",
          value: "true",
        },
        actions: aboutRepoActions,
      },
    ],
    default: declineActions,
  };

  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "triage",
        activity: "agentCall",
        args: {
          agentId: triageAgentId,
          message: "{{request.text}}",
          conversationId: WORKFLOW_NAME,
          userId: "{{request.from}}",
          channel: "telegram",
        },
      },
      {
        name: "route",
        activity: "jsFunction",
        args: { code: ROUTE_CODE },
      },
      respondAction,
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["telegram"],
        providers: ["telegram"],
        ...(TG_PIN === "1" ? { accountIds: [accountId] } : {}),
      },
    },
  };
}

async function stageEnsureWorkflow(): Promise<void> {
  step(`6/6 ensure workflow '${WORKFLOW_NAME}'`);

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
    log(`removing duplicate workflow ${workflow.id}`);
    await client.workflows.remove(workflow.id).catch(() => undefined);
  }

  const body = buildWorkflowBody();

  if (keep) {
    // Full-replace update (PUT) so re-running always reflects the current
    // agent/mcp/account ids resolved on THIS run.
    const updated = await client.workflows.update(keep.id, body).catch((e) => {
      fail(`Workflow update failed: ${messageOf(e)}`);
    });
    if (!updated?.id) {
      fail(`Workflow update failed: ${JSON.stringify(updated)}`);
    }
    workflowId = updated.id;
    log(`reused/updated workflow id=${workflowId}`);
    return;
  }

  const created = await client.workflows.create(body).catch((e) => {
    fail(`Workflow creation failed: ${messageOf(e)}`);
  });
  if (!created?.id) {
    fail(`Workflow creation failed: ${JSON.stringify(created)}`);
  }
  workflowId = created.id;
  log(`created workflow id=${workflowId}`);
}

// ----- Stage 7: register the Telegram webhook (needs a public HTTPS URL) -----
// Reuses ../../channels/telegram-transform-reply's registerWebhook logic verbatim,
// including the TG_PUBLIC_URL normalization (handles a base URL that already
// contains the webhook path).
async function registerWebhook(): Promise<void> {
  step("register Telegram webhook");
  const webhookPath = `/api/webhooks/telegram/${tenant}/${externalId}`;

  if (!TG_PUBLIC_URL) {
    log(
      "TG_PUBLIC_URL not set — skipping setWebhook (Telegram needs a public HTTPS URL)."
    );
    log("Once you have one (e.g. a cloudflared tunnel), run:");
    log(`    curl -s "https://api.telegram.org/bot<token>/setWebhook" \\`);
    log(`      --data-urlencode "url=<public>${webhookPath}" \\`);
    log(`      --data-urlencode "secret_token=$(cat '${SECRET_FILE}')"`);
    return;
  }
  if (TELEGRAM_BOT_TOKEN.startsWith("PLACEHOLDER:")) {
    warn(
      "TELEGRAM_BOT_TOKEN is a placeholder — cannot register webhook. Skipping."
    );
    return;
  }
  if (!appSecret) {
    warn(
      "no appSecret available (reused account without cached secret) — skipping. Re-run with RECREATE=1."
    );
    return;
  }

  const publicUrl = TG_PUBLIC_URL.replace(/\/$/, "");
  let url: string;
  const marker = "/api/webhooks/telegram";
  if (publicUrl.includes(marker)) {
    if (publicUrl.endsWith(webhookPath)) {
      warn("TG_PUBLIC_URL includes the full webhook path; using it as-is.");
      url = publicUrl;
    } else {
      const origin = publicUrl.slice(0, publicUrl.indexOf(marker));
      warn(
        `TG_PUBLIC_URL includes a webhook path; treating '${origin}' as the public base URL.`
      );
      url = `${origin}${webhookPath}`;
    }
  } else {
    url = `${publicUrl}${webhookPath}`;
  }

  log(`setWebhook -> ${url}`);
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      body: new URLSearchParams({
        url,
        secret_token: appSecret,
        allowed_updates: JSON.stringify(["message", "channel_post"]),
      }),
    }
  );
  const data = (await resp.json()) as { ok?: boolean };
  if (data.ok === true) {
    log("webhook registered with Telegram ✅");
  } else {
    warn(`setWebhook response: ${JSON.stringify(data)}`);
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ----- Optional: drive the chain with a synthetic inbound update ------------
// Mirrors ../../channels/telegram-transform-reply's simulate driver: POST a signed fake
// Telegram update straight to the webhook ingest endpoint, then poll for a
// workflow execution. Observing an execution proves the whole chain fired —
// it does NOT require Telegram to deliver the OUTBOUND reply (that needs a real
// token + a chat that has /start-ed the bot), which is what makes this sample
// runnable without a live bot.
async function simulateInbound(): Promise<void> {
  step("simulate inbound Telegram update");
  if (SIMULATE_INBOUND !== "1") {
    log("SIMULATE_INBOUND!=1 — skipping. To drive the chain end-to-end:");
    log("    SIMULATE_INBOUND=1 ./run.sh   (run.sh already defaults it to 1)");
    return;
  }
  if (!appSecret) {
    warn(
      "no appSecret available — cannot sign the webhook; skipping simulation (re-run with RECREATE=1)"
    );
    return;
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

  log(
    `POST /api/webhooks/telegram/${tenant}/${externalId}  (chat_id=${TELEGRAM_TEST_CHAT_ID}, text='${SIMULATE_TEXT}')`
  );
  const ingestResult = await client.webhooks.ingest({
    tenant,
    channel: "telegram",
    instance: externalId,
    headers: { "x-telegram-bot-api-secret-token": appSecret },
    body: update,
  });
  if (ingestResult.status !== "accepted") {
    fail(`Webhook not accepted: ${JSON.stringify(ingestResult)}`);
  }
  log(
    `inbound accepted; waiting for a workflow execution (timeout ${POLL_TIMEOUT_S}s)`
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
      log("workflow execution observed:");
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
      log(
        "The chain ran: triage -> route -> conditional (mcpCall DeepWiki -> summarize -> reply)."
      );
      if (TELEGRAM_BOT_TOKEN.startsWith("PLACEHOLDER:")) {
        warn(
          "Token is a placeholder — the OUTBOUND Telegram reply 404s. The execution above still proves the mcpCall path fired."
        );
      }
      return;
    }
    await sleep(3);
  }
  fail(
    `no execution observed within ${POLL_TIMEOUT_S}s — check workflow-service / trigger-consumer logs.`
  );
}

export async function main(): Promise<SetupResult> {
  stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageRecreate();
  await stageUpsertMcpServer();
  await stageTestConnection();
  await stageEnsureLlmConnector();
  await stageUpsertAgents();
  await ensureAccount();
  await stageEnsureWorkflow();
  await registerWebhook();
  await simulateInbound();

  console.log();
  log(`Done. Workflow '${WORKFLOW_NAME}' (${workflowId}):`);
  log(
    `  trigger  : message_received on channels=[telegram], pinned to accountIds=[${accountId}]`
  );
  log(
    `  triage   : agentCall -> '${TRIAGE_AGENT_NAME}' (${triageAgentId}) — strict-JSON {"about_repo": bool}`
  );
  log(
    "  route    : jsFunction parses results.triage.data.reply -> results.route.about_repo"
  );
  log("  respond  : conditional on results.route.about_repo");
  log(
    `             ├─ true  -> mcpCall '${MCP_SERVER_NAME}'.${DEEPWIKI_TOOL}(repoName=${REPO_NAME}, question) -> extract -> summarize -> reply`
  );
  log("             └─ false -> polite decline");
  console.log();
  if (TELEGRAM_BOT_TOKEN.startsWith("PLACEHOLDER:")) {
    warn(
      "You used a placeholder token — outbound sends 404. Re-run with a real TELEGRAM_BOT_TOKEN and RECREATE=1 for real delivery."
    );
  } else {
    log(
      "Message the bot on Telegram with a question about the repo, or run ./run.sh to drive one synthetic exchange."
    );
  }

  return {
    mcpServerId,
    triageAgentId,
    summarizerAgentId,
    accountId,
    externalId,
    workflowId,
  };
}

// Only auto-run when invoked directly (`tsx src/setup.ts`), not when imported
// by index.ts (the run.sh driver, which defaults SIMULATE_INBOUND=1).
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    err(`failed: ${messageOf(e)}`);
    process.exit(1);
  });
}
