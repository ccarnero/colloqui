/**
 * ai-knowledge-base-agent sample provisioning — SDK-powered replacement for
 * the old curl+jq `setup.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * Creates a knowledge base, uploads a small Markdown FAQ document, waits for
 * embeddings to finish processing, attaches the KB to a published agent via
 * `knowledge_base_ids`, then asks the agent a question whose answer only
 * exists in the uploaded document.
 *
 * Important architecture fact: knowledge bases are standalone admin
 * resources, but runtime RAG consumption is currently through agents via
 * `knowledge_base_ids`. Document ingestion can use `provider_connector_id`;
 * query-time KB search in `agent-ai-service` currently uses OpenAI
 * embeddings, so that service still needs `OPENAI_API_KEY` in its own
 * runtime environment.
 *
 * Same env vars, defaults, idempotency/dedup/RECREATE semantics, and final
 * summary output as the bash version this replaces. Invoked by `setup.sh`
 * after `../lib/resolve-env.sh` has resolved the environment. `run.sh`
 * (via `src/index.ts`) re-runs this same pipeline end to end — that mirrors
 * the old `run.sh`, which was `exec ./setup.sh`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, SdkError } from "@yoizen/platform-sdk";
import type { Agent, CreateAgentInput } from "@yoizen/platform-sdk/agents";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBaseIngestionConfig,
} from "@yoizen/platform-sdk/knowledge-bases";
import type { ExecutionResultPayload } from "@yoizen/platform-sdk/runtime";

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

function fail(message: string): never {
  err(message);
  process.exit(1);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh).
// Only script-specific vars are read here.

const KB_NAME = process.env.KB_NAME ?? "ai-sample-support-kb";
const KB_DESCRIPTION =
  process.env.KB_DESCRIPTION ??
  "Sample support FAQ knowledge base for SDK AI samples";
const KB_DOC_FILE = resolve(
  process.env.KB_DOC_FILE ?? resolve(process.cwd(), "docs/support-faq.md")
);
const KB_DOC_NAME = process.env.KB_DOC_NAME ?? "support-faq.md";
const KB_EMBEDDING_MODEL =
  process.env.KB_EMBEDDING_MODEL ?? "text-embedding-3-small";

const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-kb-agent";
const AGENT_DESCRIPTION =
  process.env.AI_AGENT_DESCRIPTION ??
  "Sample agent that answers from an attached knowledge base";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const AGENT_MESSAGE =
  process.env.AI_AGENT_MESSAGE ??
  "According to the support FAQ, what is the refund policy? Include the verification phrase if you see one.";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

const RECREATE = process.env.RECREATE ?? "0";
const POLL_TIMEOUT_S = Number(process.env.POLL_TIMEOUT_S ?? "120");
const DOC_TIMEOUT_S = Number(process.env.DOC_TIMEOUT_S ?? "120");

// ----- Provider lookup tables (mirror the bash case statements exactly) ----

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

const tenant = process.env.YOIZEN_TENANT;
const email = process.env.YOIZEN_EMAIL;
const password = process.env.YOIZEN_PASSWORD;
const baseUrl = process.env.YOIZEN_BASE_URL;
const hostHeader = process.env.YOIZEN_HOST_HEADER;

if (!tenant || !email || !password || !baseUrl) {
  fail(
    "missing required env vars: YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL (see ../lib/resolve-env.sh)"
  );
}

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
let kbId = "";
let docId = "";
let agentId = "";

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/6 preflight");

  try {
    readFileSync(KB_DOC_FILE);
  } catch {
    fail(`KB doc not found: ${KB_DOC_FILE}`);
  }

  if (CREDENTIAL_MODE !== "connector" && CREDENTIAL_MODE !== "env") {
    fail("AI_CREDENTIAL_MODE must be 'connector' or 'env'");
  }

  if (CREDENTIAL_MODE === "connector") {
    const keyVar = providerApiKeyVar(AGENT_PROVIDER);
    const keyValue = readEnvValue(keyVar);
    if (!keyVar) {
      fail(`Unsupported provider '${AGENT_PROVIDER}'`);
    }
    if (!keyValue && AGENT_PROVIDER !== "ollama") {
      fail(
        `${keyVar} is required for connector mode. Put it in .env next to setup.sh.`
      );
    }
    if (keyValue && isPlaceholderSecret(keyValue)) {
      fail(
        `${keyVar} looks like a placeholder. Replace it with a real provider key.`
      );
    }
  } else {
    warn(
      "AI_CREDENTIAL_MODE=env requires agent-ai-service to already have the provider key."
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    warn(
      "OPENAI_API_KEY is not set in this shell. Upload may still work through provider_connector_id,"
    );
    warn(
      "but runtime KB search in agent-ai-service also needs OPENAI_API_KEY in the service environment."
    );
  }

  log(
    `gateway=${baseUrl} tenant=${tenant} kb=${KB_NAME} agent=${AGENT_NAME} recreate=${RECREATE}`
  );
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
}

// ----- Stage 1: ensure LLM/embedding connector ------------------------------
async function stageEnsureLlmConnector(): Promise<void> {
  if (CREDENTIAL_MODE !== "connector") {
    return;
  }
  step(`1/6 ensure LLM/embedding connector '${LLM_CONNECTOR_NAME}'`);

  const keyVar = providerApiKeyVar(AGENT_PROVIDER);
  const baseVar = providerBaseUrlVar(AGENT_PROVIDER);
  const apiKey = readEnvValue(keyVar);
  const connectorBaseUrl =
    readEnvValue(baseVar) || providerDefaultBaseUrl(AGENT_PROVIDER);

  const connectors: Connector[] = [];
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    connectors.push(connector);
  }
  let existing = connectors.find((c) => c.name === LLM_CONNECTOR_NAME);

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting connector ${existing.id}`);
    await client.connectors.remove(existing.id).catch(() => undefined);
    existing = undefined;
  }

  const connectorBody = {
    name: LLM_CONNECTOR_NAME,
    context: "external" as const,
    baseUrl: connectorBaseUrl,
    authType: "bearer" as const,
    authConfig: { bearerToken: apiKey },
    timeoutMs: 60000,
    maxRetries: 1,
    retryBackoffMs: 500,
    tags: ["llm"],
    endpoints: [],
  };

  if (!existing) {
    const created = await client.connectors.create(connectorBody).catch((e) => {
      fail(`Connector creation failed: ${e instanceof Error ? e.message : e}`);
    });
    connectorId = created.id;
    log(`created connector id=${connectorId} baseUrl=${connectorBaseUrl}`);
  } else {
    connectorId = existing.id;
    log(`reusing connector id=${connectorId}`);
    await client.connectors.update(connectorId, {
      baseUrl: connectorBody.baseUrl,
      authType: connectorBody.authType,
      authConfig: connectorBody.authConfig,
      timeoutMs: connectorBody.timeoutMs,
      maxRetries: connectorBody.maxRetries,
      retryBackoffMs: connectorBody.retryBackoffMs,
      tags: connectorBody.tags,
    });
  }
}

// ----- Stage 2: ensure knowledge base ---------------------------------------
async function stageEnsureKb(): Promise<void> {
  step(`2/6 ensure knowledge base '${KB_NAME}'`);

  const knowledgeBases: KnowledgeBase[] = [];
  for await (const kb of client.knowledgeBases.list()) {
    knowledgeBases.push(kb);
  }
  let existing = knowledgeBases.find(
    (kb) => kb.name === KB_NAME && (kb.is_active ?? true)
  );

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting knowledge base ${existing.id}`);
    await client.knowledgeBases.remove(existing.id).catch(() => undefined);
    existing = undefined;
  }

  const ingestionConfig: KnowledgeBaseIngestionConfig = {
    chunk_size: 800,
    chunk_overlap: 120,
    embedding_model: KB_EMBEDDING_MODEL,
    chunking_strategy: "recursive",
    ...(connectorId ? { provider_connector_id: connectorId } : {}),
  };

  const body = {
    name: KB_NAME,
    description: KB_DESCRIPTION,
    project: "sdk-samples",
    category: "support",
    icon: "library_books",
    ingestion_config: ingestionConfig,
  };

  if (!existing) {
    const created = await client.knowledgeBases.create(body).catch((e) => {
      fail(
        `Knowledge base creation failed: ${e instanceof Error ? e.message : e}`
      );
    });
    kbId = created.id;
    log(`created knowledge base id=${kbId}`);
  } else {
    kbId = existing.id;
    const updated = await client.knowledgeBases
      .update(kbId, body)
      .catch((e) => {
        fail(
          `Knowledge base update failed: ${e instanceof Error ? e.message : e}`
        );
      });
    if (!updated) {
      fail(`Knowledge base update failed: not found (id=${kbId})`);
    }
    log(`updated knowledge base id=${kbId}`);
  }
}

// ----- Stage 3: upload/reingest document ------------------------------------
async function stageUploadDocument(): Promise<void> {
  step(`3/6 upload/reingest document '${KB_DOC_NAME}'`);

  const documents: KnowledgeBaseDocument[] = [];
  for await (const doc of client.knowledgeBases.documents.list(kbId)) {
    documents.push(doc);
  }
  let existing = documents.find((d) => d.original_filename === KB_DOC_NAME);

  if (existing && RECREATE === "1") {
    await client.knowledgeBases.documents
      .remove(kbId, existing.id)
      .catch(() => undefined);
    existing = undefined;
  }

  if (!existing) {
    const content = readFileSync(KB_DOC_FILE, "utf8");
    const result = await client.knowledgeBases.documents
      .upload(kbId, {
        content_text: content,
        original_filename: KB_DOC_NAME,
        mime_type: "text/markdown",
        content_type: "markdown",
      })
      .catch((e) => {
        fail(`Document upload failed: ${e instanceof Error ? e.message : e}`);
      });
    docId = result.documentId;
    log(`uploaded document id=${docId}`);
  } else {
    docId = existing.id;
    log(`reusing existing document id=${docId}; requesting reingest`);
    await client.knowledgeBases.documents.reingest(kbId, docId);
  }
}

// ----- Stage 4: wait for document ingestion ---------------------------------
async function stageWaitDocument(): Promise<void> {
  step("4/6 wait for document ingestion");

  const deadline = Date.now() + DOC_TIMEOUT_S * 1000;

  while (true) {
    const doc = await client.knowledgeBases.documents.get(kbId, docId);
    const status = doc?.status ?? "";
    const chunks = doc?.chunk_count ?? 0;

    if (status === "ready") {
      log(`document ready chunks=${chunks}`);
      return;
    }
    if (status === "failed") {
      err("document ingestion failed");
      console.error(JSON.stringify(doc, null, 2));
      fail(`document ${docId} failed to ingest`);
    }
    if (status === "pending" || status === "processing" || status === "") {
      if (Date.now() >= deadline) {
        err(
          `timed out waiting for document ${docId}; last status=${status || "unknown"}`
        );
        console.error(JSON.stringify(doc, null, 2));
        fail(`timed out waiting for document ${docId}`);
      }
      await sleep(3);
      continue;
    }
    warn(`unknown document status '${status}', continuing`);
    await sleep(3);
  }
}

// ----- Stage 5: upsert + publish KB-backed agent ----------------------------
function buildAgentBody(): CreateAgentInput {
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    system_prompt:
      "You answer using the attached knowledge base. If the knowledge base contains a verification phrase, include it. Keep the answer concise. Do not call tools unless absolutely necessary.",
    model_config: {
      llm: {
        provider: AGENT_PROVIDER,
        model: AGENT_MODEL,
        connectorId: CREDENTIAL_MODE === "connector" ? connectorId : null,
        temperature: 0.1,
        maxTokens: 300,
      },
      rules:
        "Prefer knowledge-base facts over general knowledge. If the answer is not in the KB, say so.",
      soul: "Precise and support-oriented.",
      subagents: [],
    },
    tools: [
      {
        name: "loadSkill",
        description:
          "Built-in tool enabled only to use the tool-capable runtime path.",
        source_type: "builtin",
        builtin: true,
      },
    ],
    channels: [],
    knowledge_base_ids: [kbId],
  };
}

async function stageUpsertAgent(): Promise<void> {
  step(`5/6 upsert + publish KB-backed agent '${AGENT_NAME}'`);

  const agents: Agent[] = [];
  for await (const agent of client.agents.list()) {
    if (agent.name === AGENT_NAME && agent.is_active) {
      agents.push(agent);
      break;
    }
  }
  let existingId = agents[0]?.id ?? "";

  if (existingId && RECREATE === "1") {
    await client.agents.remove(existingId).catch(() => undefined);
    existingId = "";
  }

  const body = buildAgentBody();

  if (existingId) {
    // NB: `UpdateAgentInput` doesn't declare `knowledge_base_ids` (SDK gap —
    // the downstream `UpdateAgentDto` accepts it; the old bash version sent
    // the exact same payload on both create and update). Passing our
    // `CreateAgentInput` body through still compiles (excess-property
    // checks only fire on object literals, not typed variables) and the
    // extra field reaches the wire — but callers only discover this by
    // reading the type gap here, not from the type signature itself.
    const updated = await client.agents.update(existingId, body).catch((e) => {
      fail(`Agent upsert failed: ${e instanceof Error ? e.message : e}`);
    });
    agentId = updated.id;
  } else {
    const created = await client.agents.create(body).catch((e) => {
      fail(`Agent upsert failed: ${e instanceof Error ? e.message : e}`);
    });
    agentId = created.id;
  }
  log(`agent id=${agentId} knowledge_base_ids=[${kbId}]`);

  await client.agents.publish(agentId).catch((e) => {
    fail(`Agent publish failed: ${e instanceof Error ? e.message : e}`);
  });
  log("published agent");
}

// ----- Stage 6: execute KB-backed question ----------------------------------
async function stageExecute(): Promise<void> {
  step("6/6 execute KB-backed question");

  const { executionId } = await client.runtime
    .createExecution({
      agentId,
      message: AGENT_MESSAGE,
      conversationId: "ai-knowledge-base-agent",
      channel: "sample",
      customerName: "SDK Sample",
      userId: "sdk-sample",
      context: [],
    })
    .catch((e) => {
      fail(`Execution submit failed: ${e instanceof Error ? e.message : e}`);
    });
  log(`execution id=${executionId}`);

  const deadline = Date.now() + POLL_TIMEOUT_S * 1000;

  while (true) {
    const status = await client.runtime.getExecution(executionId);
    const state = status.state;

    if (state === "completed") {
      log("completed");
      const result: ExecutionResultPayload = status.result ?? {};
      console.log(
        JSON.stringify(
          {
            executionId: status.executionId,
            state,
            agentId: status.agentId,
            reply: result.reply ?? result.response ?? null,
            usage: result.usage,
            provider: result.provider,
            model: result.model,
            costUsd: result.costUsd,
            toolCalls: result.toolCalls ?? [],
          },
          null,
          2
        )
      );
      return;
    }
    if (state === "failed") {
      err("execution failed");
      console.error(JSON.stringify(status, null, 2));
      fail(`execution ${executionId} failed`);
    }
    if (
      state === "pending" ||
      state === "running" ||
      state === "accepted" ||
      state === "queued" ||
      !state
    ) {
      if (Date.now() >= deadline) {
        err(
          `timed out waiting for execution ${executionId}; last state=${state || "unknown"}`
        );
        console.error(JSON.stringify(status, null, 2));
        fail(`timed out waiting for execution ${executionId}`);
      }
      await sleep(2);
      continue;
    }
    warn(`unknown state '${state}', continuing`);
    await sleep(2);
  }
}

export async function main(): Promise<void> {
  stagePreflight();
  await stageEnsureLlmConnector();
  await stageEnsureKb();
  await stageUploadDocument();
  await stageWaitDocument();
  await stageUpsertAgent();
  await stageExecute();
}

const isMainModule = process.argv[1]?.endsWith("setup.ts");
if (isMainModule) {
  main().catch((e) => {
    if (e instanceof SdkError) {
      err(`failed: ${e.message}`);
    } else {
      err(`failed: ${e instanceof Error ? e.message : e}`);
    }
    process.exit(1);
  });
}
