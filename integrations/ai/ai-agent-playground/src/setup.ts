/**
 * ai-agent-playground sample provisioning — SDK-powered replacement for the
 * old curl+jq `setup.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * Provisions a minimal AI agent through the same API surface used by the
 * admin-console AI pages: an (optional) LLM connector tagged "llm", then a
 * published agent wired to it. Does NOT execute anything — see src/index.ts
 * for the runtime-execution driver (mirrors the http-bridge sample's
 * setup.ts/index.ts split).
 *
 * The important part: this sample does NOT pretend AI can work without an
 * LLM. It supports two credential modes:
 *   - connector (default): creates/reuses an enabled HTTP connector tagged
 *     "llm" and sets model_config.llm.connectorId on the agent.
 *   - env: leaves connectorId empty; agent-ai-service must already have
 *     provider env vars such as OPENAI_API_KEY, ANTHROPIC_API_KEY,
 *     GROQ_API_KEY, etc.
 *
 * Contract sources (verified in code, paths relative to repo root):
 *   - Admin UI shape : services/admin-console/src/app/core/models/agent.model.ts
 *   - Agent CRUD     : services/api-gateway/src/modules/admin/admin-agents.controller.ts
 *   - Connector CRUD : services/api-gateway/src/modules/connectors/connectors.controller.ts
 *   - LLM providers  : services/agent-ai-service/src/modules/llm/provider-registry.service.ts
 *   - Credentials    : services/agent-ai-service/src/modules/llm/credential-resolver.service.ts
 *
 * Same env vars, defaults, and idempotency/dedup/RECREATE semantics as the
 * bash version this replaces. Invoked by `setup.sh` after
 * `../lib/resolve-env.sh` has resolved the environment.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { Agent } from "@yoizen/platform-sdk/agents";
import type { Connector } from "@yoizen/platform-sdk/connectors";

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

const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-playground";
const AGENT_DESCRIPTION =
  process.env.AI_AGENT_DESCRIPTION ??
  "Sample agent created by integrations/ai/ai-agent-playground";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;
const RECREATE = process.env.RECREATE ?? "0";

type ProviderMap = Record<string, string>;

const PROVIDER_API_KEY_VAR: ProviderMap = {
  anthropic: "ANTHROPIC_API_KEY",
  cohere: "COHERE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const PROVIDER_BASE_URL_VAR: ProviderMap = {
  anthropic: "ANTHROPIC_BASE_URL",
  groq: "GROQ_BASE_URL",
  mistral: "MISTRAL_BASE_URL",
  openai: "OPENAI_BASE_URL",
  ollama: "OLLAMA_BASE_URL",
  openrouter: "OPENROUTER_BASE_URL",
  xai: "XAI_BASE_URL",
};

const PROVIDER_DEFAULT_BASE_URL: ProviderMap = {
  anthropic: "https://api.anthropic.com",
  cohere: "https://api.cohere.com/v2",
  deepseek: "https://api.deepseek.com",
  google: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  ollama: "http://localhost:11434/v1",
};

function providerApiKeyVar(provider: string): string {
  return PROVIDER_API_KEY_VAR[provider.toLowerCase()] ?? "";
}
function providerBaseUrlVar(provider: string): string {
  return PROVIDER_BASE_URL_VAR[provider.toLowerCase()] ?? "";
}
function providerDefaultBaseUrl(provider: string): string {
  return PROVIDER_DEFAULT_BASE_URL[provider.toLowerCase()] ?? "";
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

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/2 preflight");

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
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  agent=${AGENT_NAME}  recreate=${RECREATE}`
  );
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
}

// ----- Stage 1: ensure the LLM connector -------------------------------------
async function stageEnsureLlmConnector(): Promise<void> {
  if (CREDENTIAL_MODE !== "connector") {
    return;
  }
  step(`1/2 ensure LLM connector '${LLM_CONNECTOR_NAME}'`);

  const keyVar = providerApiKeyVar(AGENT_PROVIDER);
  const baseVar = providerBaseUrlVar(AGENT_PROVIDER);
  const apiKey = readEnvValue(keyVar);
  let providerBaseUrl = readEnvValue(baseVar);
  if (!providerBaseUrl) {
    providerBaseUrl = providerDefaultBaseUrl(AGENT_PROVIDER);
  }

  const connectors: Connector[] = [];
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    connectors.push(connector);
  }
  connectorId = connectors.find((c) => c.name === LLM_CONNECTOR_NAME)?.id ?? "";

  if (connectorId && RECREATE === "1") {
    log(`RECREATE=1 — deleting existing connector ${connectorId}`);
    await client.connectors.remove(connectorId).catch(() => undefined);
    connectorId = "";
  }

  const connectorFields = {
    baseUrl: providerBaseUrl,
    authType: "bearer" as const,
    authConfig: { bearerToken: apiKey },
    timeoutMs: 60000,
    maxRetries: 1,
    retryBackoffMs: 500,
    tags: ["llm"],
  };

  if (!connectorId) {
    const created = await client.connectors
      .create({
        name: LLM_CONNECTOR_NAME,
        context: "external",
        endpoints: [],
        ...connectorFields,
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
    const updated = await client.connectors
      .update(connectorId, connectorFields)
      .catch((e) => {
        warn(
          `connector update returned: ${e instanceof Error ? e.message : e}`
        );
        return undefined;
      });
    if (!updated?.id) {
      warn("connector update did not return an id");
    }
  }
}

// buildAgentPayload — assemble the agent create/update body with resolved ids.
function buildAgentPayload() {
  const connectorIdValue = CREDENTIAL_MODE === "connector" ? connectorId : null;
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    system_prompt:
      "You are a concise sample agent. Answer briefly and mention if the runtime execution reached the online LLM successfully.",
    model_config: {
      llm: {
        provider: AGENT_PROVIDER,
        model: AGENT_MODEL,
        connectorId: connectorIdValue,
        temperature: 0.2,
        maxTokens: 256,
      },
      rules:
        "Keep responses short. If asked for credentials or secrets, refuse.",
      soul: "Helpful, direct, calm.",
      subagents: [],
    },
    tools: [],
    channels: [],
  };
}

async function resolveAgentIdByName(name: string): Promise<string> {
  for await (const agent of client.agents.list({ pageSize: 100 })) {
    if (agent.name === name && agent.is_active !== false) {
      return agent.id;
    }
  }
  return "";
}

// ----- Stage 2: upsert + publish the agent -----------------------------------
async function stageUpsertAgent(): Promise<void> {
  step(`2/2 upsert agent '${AGENT_NAME}'`);

  let existingId = await resolveAgentIdByName(AGENT_NAME);

  if (existingId && RECREATE === "1") {
    log(`RECREATE=1 — deleting existing agent ${existingId}`);
    await client.agents.remove(existingId).catch(() => undefined);
    existingId = "";
  }

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

async function main(): Promise<void> {
  stagePreflight();
  await stageEnsureLlmConnector();
  await stageUpsertAgent();

  console.log();
  log(`Done. Agent '${AGENT_NAME}' (${agentId}) is published.`);
  log(`  credential mode : ${CREDENTIAL_MODE}`);
  if (CREDENTIAL_MODE === "connector") {
    log(`  llm connector   : ${LLM_CONNECTOR_NAME} (${connectorId})`);
  } else {
    log(
      "  llm connector   : none — agent-ai-service must already have the provider env var"
    );
  }
  log(`  provider/model  : ${AGENT_PROVIDER} / ${AGENT_MODEL}`);
  console.log();
  log("Run ./run.sh to submit one runtime execution and poll the result.");
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
