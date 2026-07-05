/**
 * ai-system-variables sample provisioning — SDK-powered replacement for the
 * old curl+jq `setup.sh` body.
 *
 * One workflow, three verified resolution points for admin-console
 * AI > System Variables — a brand-stamped escalation router where the BRAND
 * and the ROUTING POLICY live in the tenant's variable store, not in the
 * workflow or the agent:
 *
 *   * companyName        -> stamped into the Telegram notification text of a
 *                           channelSend (action-arg templating)
 *   * escalationPriority -> the TEMPLATED RIGHT-HAND SIDE of a conditional
 *                           rule (condition.value:
 *                           "{{variables.system.escalationPriority}}") — PATCH
 *                           the variable and the workflow re-routes with no
 *                           workflow edit (subject to a 5-min cache)
 *   * brandVoice         -> referenced INSIDE the agent's system_prompt as
 *                           {{variables.system.brandVoice}}, resolved by
 *                           agent-ai-service's template renderer when the
 *                           agent runs via the workflow agentCall
 *
 *   HTTP msg -> trigger(message_received, channels:["http"], pinned to this
 *               sample's own instance via accountIds)
 *                 |
 *                 v
 *               triage  agentCall — message: {{request.text}}; the published
 *                       'ai-sample-sysvars' agent (system_prompt embeds
 *                       {{variables.system.brandVoice}} +
 *                       {{variables.system.companyName}}) replies with strict
 *                       JSON {"priority","summary"};
 *                       result lands at results.triage.data.reply
 *                 v
 *               parse   jsFunction — JSON.parse with code-fence stripping and
 *                       fail-safe fallback (unparseable -> priority "high");
 *                       returns { priority, summary } ONLY. Parse-only: the
 *                       routing decision belongs to the gateway below.
 *                 v
 *               notify  conditional — exclusive gateway whose RIGHT-HAND SIDE
 *                       is a system variable:
 *                         { variable: "results.parse.priority",
 *                           comparator: "eq",
 *                           value: "{{variables.system.escalationPriority}}" }
 *                         match   -> channelSend telegram
 *                                    "[{{variables.system.companyName}}] escalation — …"
 *                         default -> channelSend telegram
 *                                    "[{{variables.system.companyName}}] handled — …"
 *
 * Idempotent (safe to re-run): system variables are upserted by name
 * (existing VALUES are preserved unless SYSVARS_RESET=1, so a live policy
 * flip survives a re-run); connector + agent are upserted in place; the HTTP
 * instance + workflow are rebuilt when RECREATE=1 (the default).
 *
 * See ../README.md for the full contract-source citations, message flow, and
 * design-notes/gotchas. Invoked by `setup.sh` after
 * `../lib/resolve-env.sh` has resolved the environment.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { Agent } from "@yoizen/platform-sdk/agents";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type { SystemVariable } from "@yoizen/platform-sdk/system-variables";
import type { Workflow } from "@yoizen/platform-sdk/workflows";
import { fail, log, requireEnv, step, warn } from "./lib/log.js";
import {
  isPlaceholderSecret,
  providerApiKeyVar,
  providerBaseUrlVar,
  providerDefaultBaseUrl,
  readEnvValue,
} from "./lib/providers.js";
import { discoverChatId } from "./lib/telegram.js";

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh).
// Only script-specific vars are read here.

const WORKFLOW_NAME =
  process.env.SYSVARS_WORKFLOW_NAME ?? "ai-system-variables";
const APPLICATION = process.env.SYSVARS_APPLICATION ?? "samples";

// --- The three system variables this sample demonstrates ----------------------
// Values used only when the variable does not exist yet (or SYSVARS_RESET=1):
// an existing variable's value is preserved so a live PATCH survives re-runs.
const SYSVARS_COMPANY_NAME = process.env.SYSVARS_COMPANY_NAME ?? "Acme Telco";
const SYSVARS_ESCALATION_PRIORITY =
  process.env.SYSVARS_ESCALATION_PRIORITY ?? "high";
const SYSVARS_BRAND_VOICE =
  process.env.SYSVARS_BRAND_VOICE ??
  "warm and upbeat, always thanking the customer";
const SYSVARS_RESET = process.env.SYSVARS_RESET ?? "0";

// --- AI agent + LLM connector (same knobs as ai-agent-triage) -----------------
const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-sysvars";
const AGENT_DESCRIPTION =
  process.env.AI_AGENT_DESCRIPTION ??
  "Brand-voiced priority classifier created by sdk/samples/ai-system-variables";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

// --- Telegram recipient --------------------------------------------------------
// Single chat. Auto-discovered ONLY when TELEGRAM_CHAT_ID is unset (setup
// fetches the bot's own token from the platform and calls Telegram's
// getUpdates). TG_ACCOUNT_ID pins a specific Telegram channel account;
// otherwise the first active one is used.
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
let TG_ACCOUNT_ID = process.env.TG_ACCOUNT_ID ?? "";

// Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
// path segment of the per-instance ingress URL
// (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
// pinned to this account's id (accountIds) so ONLY messages to this instance
// fire it — no cross-firing with other http workflows.
const HTTP_EXTERNAL_ID =
  process.env.SYSVARS_HTTP_EXTERNAL_ID ?? "ai-system-variables";
const HTTP_ACCOUNT_NAME =
  process.env.SYSVARS_HTTP_ACCOUNT_NAME ?? "AI System Variables";

// Pin the trigger to the dedicated http instance via accountIds. ON by
// default; set SYSVARS_PIN=0 to let ANY http message trigger the workflow.
const SYSVARS_PIN = process.env.SYSVARS_PIN ?? "1";

// Defaults to always rebuild the HTTP instance + workflow: the workflow body
// embeds the agent id and chat id resolved on THIS run, so reuse-by-name
// would mask changes. Variables + connector + agent are upserted in place
// regardless. Set RECREATE=0 to reuse the existing instance/workflow by name.
const RECREATE = process.env.RECREATE ?? "1";

const SYSVARS_DISCOVER_WAIT_SECONDS = Number(
  process.env.SYSVARS_DISCOVER_WAIT_SECONDS ?? "60"
);
const SYSVARS_DISCOVER_POLL_INTERVAL = Number(
  process.env.SYSVARS_DISCOVER_POLL_INTERVAL ?? "2"
);
const SYSVARS_RESTORE_WEBHOOK = process.env.SYSVARS_RESTORE_WEBHOOK ?? "1";

// System prompt for the classifier agent. THIS IS THE POINT: the prompt
// itself references {{variables.system.brandVoice}} and
// {{variables.system.companyName}} — agent-ai-service's template renderer
// ("variables" is a whitelisted prompt namespace) resolves them when the
// agent is invoked via the workflow agentCall, because the agentCall
// activity forwards the execution context's variables (which include the
// tenant's system variables loaded at workflow start).
const SYSVARS_SYSTEM_PROMPT = `You are a customer-message priority classifier for {{variables.system.companyName}}. Your writing style is: {{variables.system.brandVoice}}.
For every customer message you receive, reply ONLY with a compact single-line JSON object and nothing else — no prose, no markdown, no code fences. The object must have exactly these keys:
{"priority": "low|normal|high|urgent", "summary": "<one short sentence, written in the brand voice above, summarizing the customer's message>"}
Rules: priority MUST be one of the listed values. Angry, threatening, or repeated-failure messages are at least high priority. Calm questions and thanks are low or normal. If the message is empty or meaningless, use priority "low".`;

// The parse step. Safely parses the agent's JSON reply from
// results.triage.data.reply (agentCall returns { status, data: { reply,
// tool_calls } }), stripping markdown code fences if the LLM adds them, and
// falling back to priority "high" (fail-safe) when parsing fails.
// Parse-only: it returns { priority, summary } and NOTHING else — the actual
// routing decision is taken by the downstream `notify` conditional gateway,
// whose right-hand side is {{variables.system.escalationPriority}}. Putting
// the comparison here would bake the policy into code; keeping it in the
// gateway keeps the policy in the variable store.
const PARSE_CODE = `(ctx) => {
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
      priority: "high", // fail safe: an unparseable classification escalates
      summary: raw ? ("unparseable agent reply: " + raw.slice(0, 160)) : "agent returned no reply"
    };
  }

  return {
    priority: parsed.priority || "normal",
    summary: parsed.summary || "(no summary)"
  };
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

let connectorId = "";
let agentId = "";
let httpAccountId = "";
let httpAppSecret = "";
let workflowId = "";
let escalationVarId = "";

// ----- Stage 0/6: preflight ---------------------------------------------------
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
  log(
    `system variables: companyName='${SYSVARS_COMPANY_NAME}'  escalationPriority='${SYSVARS_ESCALATION_PRIORITY}'  brandVoice='${SYSVARS_BRAND_VOICE}'  reset=${SYSVARS_RESET}`
  );
  if (TELEGRAM_CHAT_ID) {
    log(`telegram chat_id preset: ${TELEGRAM_CHAT_ID} (discovery skipped)`);
  } else {
    log(
      "TELEGRAM_CHAT_ID not set — will auto-discover from the bot's recent /start messages"
    );
  }
}

// ----- Stage 2/6: ensure the three system variables ---------------------------
// API contract (verified in code):
//   GET  /api/admin/system-variables         -> { variables: [ {id, name, type,
//        value, label, description, created_at, updated_at} ], total }
//        (only is_active=true rows — the runtime loads exactly the same set)
//   POST /api/admin/system-variables         -> created row (same shape)
//   PATCH /api/admin/system-variables/:id    -> updated row (same shape)
// Names are unique per tenant, so upsert-by-name is safe.
//
// Existing variables keep their CURRENT value (so a live policy flip via
// PATCH survives a setup re-run) unless SYSVARS_RESET=1.
async function findSystemVariableByName(
  name: string
): Promise<SystemVariable | undefined> {
  for await (const variable of client.systemVariables.list({ pageSize: 100 })) {
    if (variable.name === name) {
      return variable;
    }
  }
  return undefined;
}

async function ensureSystemVariable(
  name: string,
  value: string,
  label: string,
  description: string
): Promise<string> {
  const existing = await findSystemVariableByName(name);

  if (existing) {
    const existingValue = String(existing.value);
    if (SYSVARS_RESET === "1" && existingValue !== value) {
      const updated = await client.systemVariables.update(existing.id, {
        value,
      });
      if (!updated?.id) {
        fail(`system variable '${name}' PATCH failed`);
      }
      log(
        `reset variable ${name} (id=${existing.id}) '${existingValue}' -> '${value}'`
      );
    } else {
      log(
        `keeping variable ${name} (id=${existing.id}) value='${existingValue}' (SYSVARS_RESET=1 to overwrite)`
      );
    }
    return existing.id;
  }

  const created = await client.systemVariables
    .create({ name, type: "string", value, label, description })
    .catch((e) => {
      fail(
        `system variable '${name}' creation failed: ${e instanceof Error ? e.message : e}`
      );
    });
  if (!created?.id) {
    fail(
      `system variable '${name}' creation failed: ${JSON.stringify(created)}`
    );
  }
  log(`created variable ${name} (id=${created.id}) value='${value}'`);
  return created.id;
}

async function stageEnsureSystemVariables(): Promise<void> {
  step(
    "2/6 ensure system variables (companyName, escalationPriority, brandVoice)"
  );
  await ensureSystemVariable(
    "companyName",
    SYSVARS_COMPANY_NAME,
    "Company name",
    "Brand name stamped into workflow notifications (sdk/samples/ai-system-variables)"
  );
  escalationVarId = await ensureSystemVariable(
    "escalationPriority",
    SYSVARS_ESCALATION_PRIORITY,
    "Escalation priority",
    "Priority level that routes to the escalation arm — PATCH this to re-route the workflow live (sdk/samples/ai-system-variables)"
  );
  await ensureSystemVariable(
    "brandVoice",
    SYSVARS_BRAND_VOICE,
    "Brand voice",
    "Writing style injected into the classifier agent's system prompt (sdk/samples/ai-system-variables)"
  );
}

// ----- Stage 3/6: ensure LLM connector -----------------------------------------
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

  const body = {
    name: LLM_CONNECTOR_NAME,
    context: "external" as const,
    baseUrl: providerBaseUrl,
    authType: "bearer" as const,
    authConfig: { bearerToken: apiKey },
    timeoutMs: 60000,
    maxRetries: 1,
    retryBackoffMs: 500,
    tags: ["llm"],
    endpoints: [],
  };

  if (!connectorId) {
    const created: Connector | undefined = await client.connectors
      .create(body)
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
        baseUrl: body.baseUrl,
        authType: body.authType,
        authConfig: body.authConfig,
        timeoutMs: body.timeoutMs,
        maxRetries: body.maxRetries,
        retryBackoffMs: body.retryBackoffMs,
        tags: body.tags,
      })
      .catch((e) => {
        warn(
          `connector update returned: ${e instanceof Error ? e.message : e}`
        );
      });
  }
}

// ----- Stage 4/6: upsert + publish the classifier agent ------------------------
async function resolveAgentIdByName(name: string): Promise<string> {
  for await (const agent of client.agents.list({ pageSize: 100 })) {
    if (agent.name === name && (agent.is_active ?? true)) {
      return agent.id;
    }
  }
  return "";
}

// Low temperature + small maxTokens: the agent's only job is a compact,
// deterministic JSON classification. The system_prompt keeps its raw
// {{variables.system.*}} placeholders — they are stored verbatim and only
// resolved at execution time by agent-ai-service's template renderer.
function agentPayload() {
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    system_prompt: SYSVARS_SYSTEM_PROMPT,
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
  step(`4/6 upsert + publish agent '${AGENT_NAME}'`);
  const existingId = await resolveAgentIdByName(AGENT_NAME);
  const body = agentPayload();

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

// ----- Stage 5/6: resolve dependency ids (telegram account + http instance) --
async function stageResolve(): Promise<void> {
  step("5/6 resolve telegram account + http instance");

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
    fail(
      [
        "no active Telegram channel account found.",
        "Provision one first:  (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)",
        "or pin one with TG_ACCOUNT_ID=<id>.",
      ].join("\n")
    );
  }
  log(`telegram account=${TG_ACCOUNT_ID}`);

  const tgBotToken =
    tgAccounts.find((a) => a.id === TG_ACCOUNT_ID)?.accessToken ?? "";
  TELEGRAM_CHAT_ID = await discoverChatId({
    botToken: tgBotToken,
    currentChatId: TELEGRAM_CHAT_ID,
    waitSeconds: SYSVARS_DISCOVER_WAIT_SECONDS,
    pollIntervalSeconds: SYSVARS_DISCOVER_POLL_INTERVAL,
    restoreWebhook: SYSVARS_RESTORE_WEBHOOK === "1",
  });

  if (!TELEGRAM_CHAT_ID) {
    fail(
      [
        "TELEGRAM_CHAT_ID is required and could not be auto-discovered.",
        "DM your bot first, then re-run — or set TELEGRAM_CHAT_ID manually.",
      ].join("\n")
    );
  }
  log(`telegram chat_id=${TELEGRAM_CHAT_ID}`);

  await ensureHttpAccount();
}

// buildWorkflowBody — assemble the workflow definition with resolved ids.
//
// Note where {{variables.system.*}} appears and where it does NOT:
//   * channelSend.args.text embeds {{variables.system.companyName}} — resolved
//     by workflow-service's resolveTemplates at execution time.
//   * notify's condition.value IS "{{variables.system.escalationPriority}}" —
//     the conditional's right-hand side is template-resolved too
//     (temporal/workflows.ts:343-346), so the routing policy lives in the
//     variable store.
//   * The agent prompt's {{variables.system.brandVoice}} does NOT appear here
//     at all — it lives inside the published agent's system_prompt and is
//     resolved by agent-ai-service. agentCall forwards context.variables
//     (overwriting any args.variables in the definition), which is exactly
//     how the system variables reach the agent's renderer.
function notifySendFor(prefix: string, textTemplate: string) {
  return [
    {
      name: `${prefix}Send`,
      activity: "channelSend",
      args: {
        accountId: TG_ACCOUNT_ID,
        channel: "telegram",
        provider: "telegram",
        to: TELEGRAM_CHAT_ID,
        type: "text",
        text: textTemplate,
      },
    },
  ];
}

function buildWorkflowBody() {
  const alertText =
    "🚨 [{{variables.system.companyName}}] escalation — priority: {{results.parse.priority}}\n" +
    "{{results.parse.summary}}\n" +
    "Original: {{request.text}}";
  const normalText =
    "✅ [{{variables.system.companyName}}] handled — priority: {{results.parse.priority}}\n" +
    "{{results.parse.summary}}\n" +
    "Original: {{request.text}}";

  // Exclusive gateway (ConditionalAction): branches are evaluated
  // top-to-bottom, first match wins, `default` runs when none match. The
  // LEFT side (condition.variable) is a raw dot-path into the context; the
  // RIGHT side (condition.value) is template-resolved before the comparison
  // — here it resolves to the CURRENT value of the escalationPriority system
  // variable (String()-compared, comparator eq).
  const notifyAction = {
    name: "notify",
    activity: "conditional",
    branches: [
      {
        label: "Escalate",
        condition: {
          variable: "results.parse.priority",
          comparator: "eq",
          value: "{{variables.system.escalationPriority}}",
        },
        actions: notifySendFor("alert", alertText),
      },
    ],
    default: notifySendFor("resolve", normalText),
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
          conversationId: "ai-system-variables",
          userId: "{{request.from}}",
          channel: "http",
        },
      },
      {
        name: "parse",
        activity: "jsFunction",
        args: { code: PARSE_CODE },
      },
      notifyAction,
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["http"],
        providers: ["http"],
        ...(SYSVARS_PIN === "1" ? { accountIds: [httpAccountId] } : {}),
      },
    },
  };
}

// ----- Stage 6/6: ensure the workflow ------------------------------------------
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
  await stageEnsureSystemVariables();
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
    `  triage  : agentCall -> agent '${AGENT_NAME}' (${agentId}) — its system_prompt resolves {{variables.system.brandVoice}} + {{variables.system.companyName}} at run time`
  );
  log(
    "  parse   : jsFunction parses results.triage.data.reply (fail-safe -> high), returns { priority, summary }"
  );
  log(
    `  notify  : conditional — results.parse.priority eq {{variables.system.escalationPriority}} — 🚨 escalation / ✅ handled -> chat ${TELEGRAM_CHAT_ID}`
  );
  log(
    `  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)`
  );
  console.log();
  log("The routing policy is DATA, not workflow: flip it live with");
  if (escalationVarId) {
    log(
      `    curl -X PATCH '${baseUrl}/api/admin/system-variables/${escalationVarId}' \\`
    );
  } else {
    log(`    curl -X PATCH '${baseUrl}/api/admin/system-variables/<id>' \\`);
  }
  log(`      -H 'Host: ${hostHeader}' -H 'x-yoizen-tenant: ${tenant}' \\`);
  log(
    "      -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \\"
  );
  log(`      -d '{"value":"urgent"}'`);
  log("  (workflow-service caches system variables per tenant for 5 minutes —");
  log("   allow up to 5 min before new executions pick up the change)");
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
    `      -d '{"from":"customer-42","text":"This is the THIRD broken device you send me. Fix it NOW."}'`
  );
  log(
    "Or just run ./run.sh, which resolves the token and posts sample customer messages for you."
  );
  log(
    "Then check Telegram — every notification is stamped with the companyName variable."
  );
}

main().catch((e) => {
  fail(`failed: ${e instanceof Error ? e.message : e}`);
});
