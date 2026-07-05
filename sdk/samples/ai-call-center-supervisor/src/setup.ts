/**
 * ai-call-center-supervisor sample provisioning — SDK-powered replacement for
 * the old curl+jq `setup.sh` body (see sdk/GROWTH-PLAN.md P3.1, following the
 * `http-bridge` reference pattern).
 *
 * An AI supervisor loop that combines a HOSTED SERVICE (mock CRM), an AI
 * AGENT (agentCall), CONDITIONAL routing, and TELEGRAM escalation in one
 * workflow:
 *
 *   HTTP msg -> trigger (message_received, channels:["http"], pinned to this
 *               sample's own instance via accountIds)
 *                 |
 *                 v
 *   lookupCustomer     serviceCall  -> hosted service 'sample-crm' (echo
 *                                      server) POST /crm/customers/lookup —
 *                                      the echoed request body stands in for
 *                                      a CRM record
 *                 v
 *   buildTriageInput   jsFunction   -> stringifies {customer_message,
 *                                      customer_id, crm_record} — needed
 *                                      because {{...}} templating
 *                                      String()-coerces objects to
 *                                      "[object Object]"
 *                 v
 *   triage             agentCall    -> agent 'ai-sample-supervisor' returns
 *                                      compact JSON {"escalate":bool,
 *                                      "reason","suggested_reply","priority"}
 *                 v
 *   decide             jsFunction   -> safely parses the agent JSON (fallback
 *                                      = escalate:true) and builds
 *                                      alertText/resolvedText
 *                 v
 *   route              conditional  -> first-match exclusive gateway
 *                        - escalate == "true" -> notifyEscalation
 *                          (channelSend, alert)
 *                        - default            -> notifyResolved
 *                          (channelSend, resolved)
 *
 * Idempotent: reuses the service/connector/agent/instance/workflow by name.
 * Set RECREATE=1 to delete and rebuild the sample resources.
 *
 * -----------------------------------------------------------------------
 * Contract sources (verified in code, paths relative to repo root):
 *   - Action shapes  : packages/shared/src/workflow.interfaces.ts
 *                      (ServiceCallArgs needs serviceId = registered_services
 *                       UUID, never the slug; ConditionalAction takes
 *                       branches[{label, condition{variable,comparator,
 *                       value}, actions}] + default)
 *   - Executor       : services/workflow-service/src/temporal/workflows.ts
 *                      (case "conditional" — first matching branch wins,
 *                       evaluateCondition "eq" does
 *                       String(left)===String(right) so a boolean escalate
 *                       matches value "true"; {{...}} templating
 *                       String()-coerces each leaf)
 *   - Action schema  : services/workflow-service/src/modules/workflows/dto/
 *                      workflow-action.validator.ts (isConditional:
 *                      branches[] with label/condition/actions, optional
 *                      default[]; channelSend needs accountId/channel/
 *                      provider/to/type)
 *   - agentCall      : services/workflow-service/src/temporal/activities/
 *                      agent-call.activity.ts (result = { status, data:
 *                      { reply, tool_calls }, headers } -> the agent's text
 *                      lives at results.triage.data.reply)
 *   - serviceCall    : DOCS/workflows/patterns.md + connector-runtime
 *                      (result = { status, data, headers })
 *   - Registry API   : services/api-gateway/src/modules/registry/
 *                      registry.controller.ts (/api/registry/services +
 *                      /:id detail returns knativeStatus)
 *   - Readiness      : services/registry-service/src/modules/services/
 *                      services.service.ts (get() returns
 *                      knativeStatus.conditions[]; Ready/True)
 *   - Agent CRUD     : services/api-gateway/src/modules/admin/
 *                      admin-agents.controller.ts
 *   - HTTP webhook   : services/api-gateway/src/modules/channels/
 *                      webhooks.controller.ts (POST
 *                      /api/webhooks/http/<tenant>/<externalId>)
 * -----------------------------------------------------------------------
 * PREREQS:
 *   - A Telegram channel account with a REAL bot token
 *       -> sdk/samples/telegram-transform-reply/setup.sh
 *     and the supervisor must have /start-ed that bot (chat_id discovery).
 *   - An LLM provider key (OPENAI_API_KEY by default) in .env — the triage
 *     agent needs a real online LLM.
 *   - A cluster with registry-service + Knative (hosted services).
 * -----------------------------------------------------------------------
 * Telegram chat_id discovery talks directly to `api.telegram.org`
 * (getWebhookInfo / deleteWebhook / getUpdates / setWebhook) — that's raw
 * Telegram Bot API, not part of our platform SDK, so it stays as plain
 * `fetch()` calls (same as ../http-bridge).
 *
 * Invoked by `setup.sh` after `../lib/resolve-env.sh` has resolved the
 * environment.
 */
import * as readline from "node:readline";
import { createClient } from "@yoizen/platform-sdk";
import type { Agent } from "@yoizen/platform-sdk/agents";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type { RegisteredService } from "@yoizen/platform-sdk/registry";
import type { Workflow } from "@yoizen/platform-sdk/workflows";

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
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh). Only
// script-specific vars are read here.

const WORKFLOW_NAME =
  process.env.SUPERVISOR_WORKFLOW_NAME ?? "ai-call-center-supervisor";
const APPLICATION = process.env.SUPERVISOR_APPLICATION ?? "samples";

// Hosted mock-CRM service (same knobs/style as ../hosted-services-api).
const CRM_SERVICE_NAME = process.env.CRM_SERVICE_NAME ?? "sample-crm";
const CRM_SERVICE_IMAGE =
  process.env.CRM_SERVICE_IMAGE ?? "ealen/echo-server:latest";
const CRM_SERVICE_PORT = Number(process.env.CRM_SERVICE_PORT ?? "8080");
const CRM_MIN_SCALE = Number(process.env.CRM_MIN_SCALE ?? "0");
const CRM_MAX_SCALE = Number(process.env.CRM_MAX_SCALE ?? "2");
const CRM_CONCURRENCY_TARGET = Number(
  process.env.CRM_CONCURRENCY_TARGET ?? "25"
);
const CRM_READY_TIMEOUT_S = Number(process.env.CRM_READY_TIMEOUT_S ?? "120");

// AI triage agent (same knobs/style as ../ai-agent-playground).
const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-supervisor";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

// Telegram supervisor chat — auto-discovered from the bot's recent messages
// if left unset (same mechanism as ../http-bridge).
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
let TG_ACCOUNT_ID = process.env.TG_ACCOUNT_ID ?? "";
const SUPERVISOR_RESTORE_WEBHOOK =
  process.env.SUPERVISOR_RESTORE_WEBHOOK ?? "1";
const SUPERVISOR_DISCOVER_WAIT_SECONDS = Number(
  process.env.SUPERVISOR_DISCOVER_WAIT_SECONDS ?? "60"
);
const SUPERVISOR_DISCOVER_POLL_INTERVAL = Number(
  process.env.SUPERVISOR_DISCOVER_POLL_INTERVAL ?? "2"
);

// Dedicated HTTP channel INSTANCE for this sample (its externalId is the last
// path segment of /api/webhooks/http/<tenant>/<externalId>). The workflow
// trigger is pinned to this account id so ONLY messages posted to this
// instance fire it.
const HTTP_EXTERNAL_ID =
  process.env.SUPERVISOR_HTTP_EXTERNAL_ID ?? "ai-call-center-supervisor";
const HTTP_ACCOUNT_NAME =
  process.env.SUPERVISOR_HTTP_ACCOUNT_NAME ?? "AI Call Center Supervisor";
const SUPERVISOR_PIN = process.env.SUPERVISOR_PIN ?? "1";

const RECREATE = process.env.RECREATE ?? "0";

// buildTriageInput: {{...}} templating String()-coerces each leaf, so passing
// {{results.lookupCustomer.data}} into the agent message would yield
// "[object Object]". This step stringifies the whole triage payload instead;
// the agent message then references {{results.buildTriageInput.text}}.
const TRIAGE_INPUT_CODE = `(ctx) => {
  var req = ctx.request || {};
  var lookup = ctx.results.lookupCustomer || {};
  var payload = {
    customer_message: req.text || "",
    customer_id: req.from || "unknown",
    crm_record: lookup.data || {}
  };
  return { text: JSON.stringify(payload) };
}`;

// decide: safely parses the agent's JSON verdict. Any parse failure falls
// back to escalate:true (fail-safe: a broken triage always reaches a human).
// Builds both notification texts; the conditional router picks which one is
// sent.
const DECIDE_CODE = `(ctx) => {
  var req = ctx.request || {};
  var triage = ctx.results.triage || {};
  var raw = (triage.data && triage.data.reply) || "";
  var verdict = {
    escalate: true,
    reason: "agent reply was not parseable JSON",
    suggested_reply: "",
    priority: "high"
  };
  try {
    var text = String(raw).trim();
    var fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/);
    if (fenced) text = fenced[1].trim();
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    var parsed = JSON.parse(text);
    if (typeof parsed.escalate === "boolean") {
      verdict = {
        escalate: parsed.escalate,
        reason: String(parsed.reason || ""),
        suggested_reply: String(parsed.suggested_reply || ""),
        priority: String(parsed.priority || "normal")
      };
    }
  } catch (e) {
    /* keep fail-safe fallback: escalate */
  }
  var who = req.from || "unknown";
  var msg = req.text || "";
  var alertText =
    "\u{1F6A8} SUPERVISOR ESCALATION\\n" +
    "Customer: " + who + "\\n" +
    "Message: " + msg + "\\n" +
    "Priority: " + verdict.priority + "\\n" +
    "Reason: " + verdict.reason + "\\n" +
    "Suggested reply: " + (verdict.suggested_reply || "(none)");
  var resolvedText =
    "\u{2705} AUTO-RESOLVED\\n" +
    "Customer: " + who + "\\n" +
    "Message: " + msg + "\\n" +
    "Reason: " + verdict.reason + "\\n" +
    "Suggested reply: " + (verdict.suggested_reply || "(none)");
  return {
    escalate: verdict.escalate,
    priority: verdict.priority,
    reason: verdict.reason,
    alertText: alertText,
    resolvedText: resolvedText
  };
}`;

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

let serviceId = "";
let connectorId = "";
let agentId = "";
let httpAccountId = "";
let httpAppSecret = "";
let workflowId = "";

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/7 preflight");

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(CRM_SERVICE_NAME)) {
    fail(
      "CRM_SERVICE_NAME must be lowercase alphanumeric with optional hyphens"
    );
  }

  if (CREDENTIAL_MODE !== "connector" && CREDENTIAL_MODE !== "env") {
    fail("AI_CREDENTIAL_MODE must be 'connector' or 'env'");
  }

  if (CREDENTIAL_MODE === "connector") {
    const keyVar = providerApiKeyVar(AGENT_PROVIDER);
    if (!keyVar) {
      fail(`Unsupported provider '${AGENT_PROVIDER}'`);
    }
    const keyValue = readEnvValue(keyVar);
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
  } else {
    warn(
      "credential mode=env: agent-ai-service must already have the provider key in its deployment env."
    );
  }

  log(
    `crm=${CRM_SERVICE_NAME} (${CRM_SERVICE_IMAGE}:${CRM_SERVICE_PORT})  agent=${AGENT_NAME} (${AGENT_PROVIDER}/${AGENT_MODEL})  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}`
  );
}

// ----- Stage 2: ensure hosted mock-CRM service -------------------------------
async function findServiceByName(
  name: string
): Promise<RegisteredService | undefined> {
  for await (const service of client.registry.services.list()) {
    if (service.name === name) {
      return service;
    }
  }
  return undefined;
}

function crmServiceBody() {
  return {
    name: CRM_SERVICE_NAME,
    image: CRM_SERVICE_IMAGE,
    port: CRM_SERVICE_PORT,
    minScale: CRM_MIN_SCALE,
    maxScale: CRM_MAX_SCALE,
    concurrencyTarget: CRM_CONCURRENCY_TARGET,
    envVars: { YOIZEN_SAMPLE: "ai-call-center-supervisor" },
  };
}

// waitForCrmReady — GET /api/registry/services/:id returns
// knativeStatus.conditions[] — wait for Ready/True. Non-fatal on timeout: with
// minScale=0 the first serviceCall cold-starts the pod anyway; a warning is
// enough.
async function waitForCrmReady(): Promise<void> {
  const deadline = Date.now() + CRM_READY_TIMEOUT_S * 1000;
  log(
    `waiting up to ${CRM_READY_TIMEOUT_S}s for Knative readiness of '${CRM_SERVICE_NAME}'...`
  );
  let lastReady: string | undefined;
  while (true) {
    const detail = await client.registry.services.get(serviceId);
    const conditions =
      (detail.knativeStatus?.conditions as
        | Array<{ type?: string; status?: string }>
        | undefined) ?? [];
    lastReady = conditions.find((c) => c.type === "Ready")?.status;
    if (lastReady === "True") {
      log("hosted service is Ready");
      return;
    }
    if (Date.now() >= deadline) {
      warn(
        `service not Ready after ${CRM_READY_TIMEOUT_S}s (last Ready=${lastReady ?? "unknown"}) — continuing; the first serviceCall may cold-start it`
      );
      return;
    }
    await sleep(3);
  }
}

async function stageEnsureCrm(): Promise<void> {
  step(`2/7 ensure hosted mock-CRM service '${CRM_SERVICE_NAME}'`);

  let existing = await findServiceByName(CRM_SERVICE_NAME);

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting service ${existing.id}`);
    await client.registry.services.remove(existing.id).catch(() => undefined);
    existing = undefined;
  }

  const body = crmServiceBody();

  if (existing) {
    const { name: _name, ...updateBody } = body;
    const updated = await client.registry.services
      .update(existing.id, updateBody)
      .catch((e) => {
        fail(
          `CRM service update failed: ${e instanceof Error ? e.message : e}`
        );
      });
    if (updated.id !== existing.id) {
      fail(`CRM service update failed: unexpected response id`);
    }
    serviceId = existing.id;
    log(`updated existing service ${serviceId}`);
  } else {
    const created = await client.registry.services.create(body).catch((e) => {
      fail(
        `CRM service creation failed: ${e instanceof Error ? e.message : e}`
      );
    });
    if (!created?.id) {
      fail(`CRM service creation failed: ${JSON.stringify(created)}`);
    }
    serviceId = created.id;
    log(`created service ${serviceId}`);
  }

  await waitForCrmReady();
}

// ----- Stage 3: ensure LLM connector -----------------------------------------
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
    step("3/7 skip LLM connector (AI_CREDENTIAL_MODE=env)");
    return;
  }
  step(`3/7 ensure LLM connector '${LLM_CONNECTOR_NAME}'`);

  const keyVar = providerApiKeyVar(AGENT_PROVIDER);
  const baseVar = providerBaseUrlVar(AGENT_PROVIDER);
  const apiKey = readEnvValue(keyVar);
  const baseUrlValue =
    readEnvValue(baseVar) || providerDefaultBaseUrl(AGENT_PROVIDER);

  connectorId = await resolveConnectorIdByName(LLM_CONNECTOR_NAME);

  const body = {
    name: LLM_CONNECTOR_NAME,
    context: "external" as const,
    baseUrl: baseUrlValue,
    authType: "bearer" as const,
    authConfig: { bearerToken: apiKey },
    timeoutMs: 60000,
    maxRetries: 1,
    retryBackoffMs: 500,
    tags: ["llm"],
    endpoints: [],
  };

  if (!connectorId) {
    const created = await client.connectors.create(body).catch((e) => {
      fail(
        `LLM connector creation failed: ${e instanceof Error ? e.message : e}`
      );
    });
    if (!created?.id) {
      fail(`LLM connector creation failed: ${JSON.stringify(created)}`);
    }
    connectorId = created.id;
    log(`created connector id=${connectorId} baseUrl=${baseUrlValue}`);
  } else {
    log(`reusing connector id=${connectorId}`);
    const { name: _name, endpoints: _endpoints, ...updateBody } = body;
    await client.connectors.update(connectorId, updateBody).catch((e) => {
      warn(`connector update returned: ${e instanceof Error ? e.message : e}`);
    });
  }
}

// ----- Stage 4: ensure + publish the triage agent ----------------------------
async function resolveAgentIdByName(name: string): Promise<string> {
  for await (const agent of client.agents.list()) {
    if (agent.name === name && (agent.is_active ?? true)) {
      return agent.id;
    }
  }
  return "";
}

function agentPayload() {
  const connectorIdValue = CREDENTIAL_MODE === "connector" ? connectorId : null;
  return {
    name: AGENT_NAME,
    description:
      "AI call-center supervisor triage agent created by sdk/samples/ai-call-center-supervisor",
    system_prompt:
      'You are an AI call-center supervisor triage assistant. Each user message is a JSON payload with fields customer_message, customer_id, and crm_record. Analyze it and respond with ONLY a compact single-line JSON object — no markdown, no code fences, no commentary: {"escalate": true|false, "reason": "short explanation", "suggested_reply": "reply the agent could send the customer", "priority": "low|normal|high|urgent"}. Set escalate to true when ANY of these hold: the sentiment is very negative or abusive; a refund greater than $100 is mentioned or demanded; legal action is threatened; or the customer threatens to cancel or shows clear churn risk. Otherwise set escalate to false and provide a helpful suggested_reply.',
    model_config: {
      llm: {
        provider: AGENT_PROVIDER,
        model: AGENT_MODEL,
        connectorId: connectorIdValue,
        temperature: 0.1,
        maxTokens: 300,
      },
      rules:
        "Output strictly the JSON object described in the system prompt. Never add any text before or after it.",
      soul: "Calm, precise, risk-aware.",
      subagents: [],
    },
    tools: [],
    channels: [],
  };
}

async function stageEnsureAgent(): Promise<void> {
  step(`4/7 ensure + publish agent '${AGENT_NAME}'`);

  let existingId = await resolveAgentIdByName(AGENT_NAME);

  if (existingId && RECREATE === "1") {
    log(`RECREATE=1 — deleting existing agent ${existingId}`);
    await client.agents.remove(existingId).catch(() => undefined);
    existingId = "";
  }

  const body = agentPayload();

  let agent: Agent;
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

// ----- Telegram chat_id discovery (raw Telegram Bot API, not SDK-covered) ---

interface TelegramChat {
  id: string;
  label: string;
  date: number;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// fetchTelegramChats <botToken> — one getUpdates call, returns one row per
// distinct chat, most recent first (same as ../http-bridge).
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

// discoverChatId <botToken> — auto-fill TELEGRAM_CHAT_ID from whoever
// /start-ed the bot most recently. getUpdates and an active webhook are
// mutually exclusive on the same bot token (Telegram 409s), so the current
// webhook is captured, cleared, and restored afterward — and updates already
// consumed by the webhook do NOT replay, hence the interactive prompt. See
// ../http-bridge/src/setup.ts for the full rationale.
async function discoverChatId(botToken: string): Promise<void> {
  if (TELEGRAM_CHAT_ID) {
    return;
  }
  if (!botToken || botToken.startsWith("PLACEHOLDER:")) {
    warn(
      "telegram account has no real bot token — cannot auto-discover chat_id"
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
    await promptOrWait(SUPERVISOR_DISCOVER_WAIT_SECONDS);

    for (let attempt = 0; attempt < 5; attempt++) {
      chats = await fetchTelegramChats(botToken);
      if (chats.length > 0) {
        break;
      }
      await sleep(SUPERVISOR_DISCOVER_POLL_INTERVAL);
    }
  } else {
    chats = await fetchTelegramChats(botToken);
  }

  if (chats.length === 0) {
    warn(
      "no Telegram chats found — send /start to the bot, then re-run (or set TELEGRAM_CHAT_ID)"
    );
  } else {
    log("discovered telegram chats (most recent first):");
    for (const chat of chats) {
      log(`  chat_id=${chat.id}  (${chat.label})`);
    }
    TELEGRAM_CHAT_ID = chats[0].id;
    log(
      `auto-selected TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID} (most recent chat)`
    );
  }

  if (webhookUrl) {
    if (SUPERVISOR_RESTORE_WEBHOOK === "1") {
      log(`restoring webhook -> ${webhookUrl}`);
      await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
    } else {
      warn(
        "SUPERVISOR_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh to restore it"
      );
    }
  }
}

// ensureHttpAccount — resolve (or create) the sample's dedicated HTTP channel
// instance, identified by externalId. Captures httpAccountId + httpAppSecret.
// Deduplicates on every run.
async function ensureHttpAccount(): Promise<void> {
  const accounts: ChannelAccount[] = [];
  for await (const account of client.channels.listAccounts({
    channel: "http",
  })) {
    accounts.push(account);
  }

  // Collect ALL exact-externalId-matching active accounts, newest first (the
  // API returns them oldest-first, so reverse).
  const matching = accounts
    .filter((a) => a.externalId === HTTP_EXTERNAL_ID && a.isActive)
    .reverse();

  const keep = matching[0];
  const stale = matching.slice(1);

  for (const account of stale) {
    log(`removing duplicate HTTP instance ${account.id}`);
    await client.channels.removeAccount(account.id).catch(() => undefined);
  }

  if (keep && RECREATE !== "1") {
    httpAccountId = keep.id;
    httpAppSecret = keep.appSecret ?? "";
    log(
      `reusing HTTP instance ${httpAccountId} (externalId=${HTTP_EXTERNAL_ID})`
    );
    return;
  }

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

// ----- Stage 5: resolve telegram account + supervisor chat -------------------
async function stageResolve(): Promise<void> {
  step("5/7 resolve telegram account + supervisor chat + http instance");

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
  await discoverChatId(tgBotToken);

  if (!TELEGRAM_CHAT_ID) {
    err("TELEGRAM_CHAT_ID is required and could not be auto-discovered.");
    err("DM your bot first, then re-run — or set TELEGRAM_CHAT_ID manually.");
    process.exit(1);
  }
  log(`supervisor chat_id=${TELEGRAM_CHAT_ID}`);

  await ensureHttpAccount();
}

// ----- Stage 6: ensure the workflow -------------------------------------------
function buildWorkflowBody() {
  const sendBase = {
    accountId: TG_ACCOUNT_ID,
    channel: "telegram",
    provider: "telegram",
    to: TELEGRAM_CHAT_ID,
    type: "text",
  };

  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "lookupCustomer",
        activity: "serviceCall",
        args: {
          serviceId,
          serviceSlug: CRM_SERVICE_NAME,
          method: "POST",
          path: "/crm/customers/lookup",
          data: {
            customerId: "{{request.from}}",
            message: "{{request.text}}",
            source: "ai-call-center-supervisor",
          },
        },
      },
      {
        name: "buildTriageInput",
        activity: "jsFunction",
        args: { code: TRIAGE_INPUT_CODE },
      },
      {
        name: "triage",
        activity: "agentCall",
        args: {
          agentId,
          message: "{{results.buildTriageInput.text}}",
          conversationId: "ai-call-center-supervisor",
          channel: "http",
          userId: "{{request.from}}",
        },
      },
      {
        name: "decide",
        activity: "jsFunction",
        args: { code: DECIDE_CODE },
      },
      {
        name: "route",
        activity: "conditional",
        branches: [
          {
            label: "Escalate to supervisor",
            condition: {
              variable: "results.decide.escalate",
              comparator: "eq",
              value: "true",
            },
            actions: [
              {
                name: "notifyEscalation",
                activity: "channelSend",
                args: { ...sendBase, text: "{{results.decide.alertText}}" },
              },
            ],
          },
        ],
        default: [
          {
            name: "notifyResolved",
            activity: "channelSend",
            args: { ...sendBase, text: "{{results.decide.resolvedText}}" },
          },
        ],
      },
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["http"],
        providers: ["http"],
        ...(SUPERVISOR_PIN === "1" ? { accountIds: [httpAccountId] } : {}),
      },
    },
  };
}

async function stageEnsureWorkflow(): Promise<void> {
  step(`6/7 ensure workflow '${WORKFLOW_NAME}'`);

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

  if (keep && RECREATE !== "1") {
    workflowId = keep.id;
    const updated = await client.workflows
      .update(workflowId, body)
      .catch((e) => {
        fail(`Workflow update failed: ${e instanceof Error ? e.message : e}`);
      });
    if (updated.id !== workflowId) {
      fail(`Workflow update failed: unexpected response id`);
    }
    log(`updated existing workflow ${workflowId}`);
    return;
  }

  if (keep) {
    log(`RECREATE=1 — deleting workflow ${keep.id}`);
    await client.workflows.remove(keep.id).catch(() => undefined);
  }

  const created = await client.workflows.create(body).catch((e) => {
    fail(`Workflow creation failed: ${e instanceof Error ? e.message : e}`);
  });
  if (!created?.id) {
    fail(`Workflow creation failed: ${JSON.stringify(created)}`);
  }
  workflowId = created.id;
  log(`created workflow id=${workflowId}`);
}

// ----- Stage 7: summary -------------------------------------------------------
function stageSummary(): void {
  step("7/7 summary");
  const ingestUrl = `${baseUrl}/api/webhooks/http/${tenant}/${HTTP_EXTERNAL_ID}`;
  log(`crm service : ${serviceId} (${CRM_SERVICE_NAME})`);
  log(
    `agent       : ${agentId} (${AGENT_NAME}, ${AGENT_PROVIDER}/${AGENT_MODEL})`
  );
  log(`workflow    : ${workflowId} (${WORKFLOW_NAME})`);
  log(`http input  : ${ingestUrl}`);
  log(`telegram    : supervisor chat ${TELEGRAM_CHAT_ID}`);
  console.log();
  log(
    "Drive it (or just run ./run.sh, which posts both test messages for you):"
  );
  log(`  curl -X POST '${ingestUrl}' \\`);
  if (httpAppSecret) {
    log(`    -H 'x-http-channel-token: ${httpAppSecret}' \\`);
  } else {
    log(
      "    -H 'x-http-channel-token: <app-secret>' \\   # re-run with RECREATE=1 to mint one"
    );
  }
  log("    -H 'content-type: application/json' \\");
  log(
    `    -d '{"from":"cust-1001","text":"third time my bill is wrong, I want a $200 refund or I cancel"}'`
  );
  log(
    "Then check Telegram: angry messages arrive as a \u{1F6A8} SUPERVISOR ESCALATION,"
  );
  log("calm ones as a \u{2705} AUTO-RESOLVED summary.");
}

async function main(): Promise<void> {
  stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageEnsureCrm();
  await stageEnsureLlmConnector();
  await stageEnsureAgent();
  await stageResolve();
  await stageEnsureWorkflow();
  stageSummary();
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
