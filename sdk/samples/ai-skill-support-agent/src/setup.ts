/**
 * ai-skill-support-agent sample provisioning — SDK-powered replacement for
 * the old curl+jq `setup.sh` body (mirrors http-bridge's src/setup.ts
 * pattern, see sdk/GROWTH-PLAN.md P3.1).
 *
 * Provisions a call-center support agent that combines the two AI catalog
 * features:
 *   1. A custom SKILL from AI > Skills ("refund-policy-expert"): a reusable
 *      prompt package with trigger commands, when-to-use routing hints and a
 *      reference cheat-sheet file. It is attached to the agent through
 *      model_config.subagents with catalog_skill_id.
 *   2. A KNOWLEDGE BASE from AI > Knowledge Bases ("ai-sample-callcenter-kb")
 *      with the full Acme Telco policy handbook uploaded and embedded,
 *      attached through knowledge_base_ids.
 *
 * Flow: preflight -> ensure LLM connector -> ensure skill -> ensure KB ->
 *       upload/reingest document + poll -> agent upsert -> publish. Run
 *       ./run.sh afterwards to ask questions.
 *
 * Contract sources (verified in code, paths relative to repo root):
 *   - Skills API      : services/api-gateway/src/modules/admin/admin-skills.controller.ts
 *                       services/agent-admin-service/src/modules/skills/skills.dto.ts
 *                       services/agent-admin-service/src/modules/skills/skills.service.ts
 *   - Subagent shape  : services/admin-console/src/app/core/models/agent.model.ts (ISubagentConfig)
 *   - Skill runtime   : services/agent-ai-service/src/modules/chat/chat.service.ts (preparePrompt)
 *                       services/agent-ai-service/src/modules/skills/skill-mapper.ts (CatalogSkill)
 *                       services/agent-ai-service/src/modules/skills/skill-router.service.ts
 *   - KB CRUD/ingest  : sdk/samples/ai-knowledge-base-agent/setup.sh (same contract)
 *   - Agent CRUD      : services/api-gateway/src/modules/admin/admin-agents.controller.ts
 *   - Runtime exec    : services/api-gateway/src/modules/runtime/runtime.controller.ts
 *
 * Runtime note (verified): agent-ai-service consumes model_config.subagents
 * directly — it does NOT re-fetch the skill by catalog_skill_id. The admin
 * console copies the catalog skill snapshot into the subagent entry, so this
 * script does the same: the subagent carries the full skill snapshot
 * (system_prompt, trigger_commands, when_to_use, priority, mode) PLUS
 * catalog_skill_id as the link back to the catalog entry.
 *
 * Same env vars, defaults, and idempotency/dedup/RECREATE semantics as the
 * bash version this replaces. Invoked by `setup.sh` after
 * `../lib/resolve-env.sh` has resolved the environment and `cd`'d into this
 * sample's directory (so `process.cwd()` matches the old `$(pwd)`).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@yoizen/platform-sdk";
import type { CreateAgentInput } from "@yoizen/platform-sdk/agents";
import type { CreateConnectorInput } from "@yoizen/platform-sdk/connectors";
import type {
  CreateKnowledgeBaseInput,
  KnowledgeBaseIngestionConfig,
} from "@yoizen/platform-sdk/knowledge-bases";
import type { CreateSkillInput, SkillFile } from "@yoizen/platform-sdk/skills";

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

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh).
// Only script-specific vars are read here.

const SKILL_NAME = process.env.AI_SKILL_NAME ?? "refund-policy-expert";
const KB_NAME = process.env.KB_NAME ?? "ai-sample-callcenter-kb";
const KB_DESCRIPTION =
  process.env.KB_DESCRIPTION ??
  "Acme Telco call-center policy handbook for SDK AI samples";
const KB_DOC_FILE =
  process.env.KB_DOC_FILE ??
  path.join(process.cwd(), "policy", "acme-telco-policy.md");
const KB_DOC_NAME = process.env.KB_DOC_NAME ?? "acme-telco-policy.md";
const KB_EMBEDDING_MODEL =
  process.env.KB_EMBEDDING_MODEL ?? "text-embedding-3-small";

const AGENT_NAME = process.env.AI_AGENT_NAME ?? "ai-sample-support";
const AGENT_DESCRIPTION =
  process.env.AI_AGENT_DESCRIPTION ??
  "Call-center support agent with a catalog skill and a knowledge base";
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

const RECREATE = process.env.RECREATE ?? "0";
const DOC_TIMEOUT_S = Number(process.env.DOC_TIMEOUT_S ?? "120");

// ----- Provider lookup tables (mirrors bash's provider_* case statements) ---

const PROVIDER_API_KEY_VAR: Record<string, string> = {
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

const PROVIDER_BASE_URL_VAR: Record<string, string> = {
  anthropic: "ANTHROPIC_BASE_URL",
  groq: "GROQ_BASE_URL",
  mistral: "MISTRAL_BASE_URL",
  openai: "OPENAI_BASE_URL",
  ollama: "OLLAMA_BASE_URL",
  openrouter: "OPENROUTER_BASE_URL",
  xai: "XAI_BASE_URL",
};

const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
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

// ----- Client setup -----------------------------------------------------

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
let skillId = "";
let kbId = "";
let docId = "";
let agentId = "";

// ----- Stage 0: preflight -----------------------------------------------
function stagePreflight(): void {
  step("0/6 preflight");

  if (!fs.existsSync(KB_DOC_FILE)) {
    fail(`Policy doc not found: ${KB_DOC_FILE}`);
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
      "OPENAI_API_KEY is not set in this shell. KB upload may still work through provider_connector_id,"
    );
    warn(
      "but runtime KB search in agent-ai-service also needs OPENAI_API_KEY in the service environment."
    );
  }

  log(
    `gateway=${baseUrl} tenant=${tenant} skill=${SKILL_NAME} kb=${KB_NAME} agent=${AGENT_NAME} recreate=${RECREATE}`
  );
}

// ----- Stage 1: ensure LLM/embedding connector ---------------------------
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

  let existing: string | undefined;
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    if (connector.name === LLM_CONNECTOR_NAME) {
      existing = connector.id;
      break;
    }
  }

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting connector ${existing}`);
    await client.connectors.remove(existing).catch(() => undefined);
    existing = undefined;
  }

  const body: CreateConnectorInput = {
    name: LLM_CONNECTOR_NAME,
    context: "external",
    baseUrl: connectorBaseUrl,
    authType: "bearer",
    authConfig: { bearerToken: apiKey },
    timeoutMs: 60000,
    maxRetries: 1,
    retryBackoffMs: 500,
    tags: ["llm"],
    endpoints: [],
  };

  if (!existing) {
    const created = await client.connectors.create(body).catch((e) => {
      fail(`Connector creation failed: ${e instanceof Error ? e.message : e}`);
    });
    connectorId = created?.id ?? "";
    if (!connectorId) {
      fail(`Connector creation failed: ${JSON.stringify(created)}`);
    }
    log(`created connector id=${connectorId} baseUrl=${connectorBaseUrl}`);
  } else {
    connectorId = existing;
    log(`reusing connector id=${connectorId}`);
    await client.connectors.update(connectorId, {
      baseUrl: body.baseUrl,
      authType: body.authType,
      authConfig: body.authConfig,
      timeoutMs: body.timeoutMs,
      maxRetries: body.maxRetries,
      retryBackoffMs: body.retryBackoffMs,
      tags: body.tags,
    });
  }
}

// ----- Skill payload (shared by the catalog-skill stage and the agent's
// subagent snapshot) ---------------------------------------------------

// Fields verified against CreateSkillDto in
// services/agent-admin-service/src/modules/skills/skills.dto.ts:
//   name, description, system_prompt, icon, color, trigger_commands[],
//   when_to_use, priority (0-1000), allowed_tools[],
//   mode in [router, llm_driven, inline],
//   files[{name, path, type in [script, reference, asset], content}]
const REFUND_CHEATSHEET = `# Refund cheat-sheet (Acme Telco policy v3, condensed)

- Devices: full refund within 30 days of delivery (45 days for Acme Max customers).
- Accessories: 14 days.
- Prepaid top-ups / consumed data packs: non-refundable.
- Plan charges: prorated refund only for confirmed outages > 48 h.
- Restocking fee: 15% for opened, non-defective devices returned after day 15.
- Refunds go to the original payment method; 5-7 business days after inspection.
- RMA number required before any return shipment.
- Outside the window: never promise a refund — escalate to Tier 2 Billing (24 h SLA).
`;

function buildSkillPayload(): CreateSkillInput {
  const files: SkillFile[] = [
    {
      name: "refund-cheatsheet.md",
      path: "reference/refund-cheatsheet.md",
      type: "reference",
      content: REFUND_CHEATSHEET,
    },
  ];

  return {
    name: SKILL_NAME,
    description:
      "Expert handling of refund and return requests under the Acme Telco policy.",
    system_prompt:
      "You are the refund-policy expert for Acme Telco support. Steps: (1) identify the item type (device, accessory, prepaid) and the days elapsed since delivery; (2) apply the matching refund window (30 days devices, 45 for Acme Max, 14 accessories, prepaid non-refundable); (3) check the restocking-fee rule for opened non-defective devices after day 15; (4) if the request is inside policy, explain the RMA step and the 5-7 business day timeline; (5) if it is outside policy, decline politely and offer escalation to Tier 2 Billing. Always cite the policy section applied.",
    icon: "currency_exchange",
    color: "#66bb6a",
    trigger_commands: ["refund", "reembolso"],
    when_to_use:
      "Use when the customer asks about refunds, returns, RMA, restocking fees, or money back.",
    priority: 10,
    allowed_tools: [],
    mode: "llm_driven",
    files,
  };
}

// ----- Stage 2: ensure catalog skill --------------------------------------
async function stageEnsureSkill(): Promise<void> {
  step(`2/6 ensure catalog skill '${SKILL_NAME}'`);

  let existing: string | undefined;
  for await (const skill of client.skills.list()) {
    if (skill.name === SKILL_NAME && (skill.is_active ?? true)) {
      existing = skill.id;
      break;
    }
  }

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting skill ${existing}`);
    await client.skills.remove(existing).catch(() => undefined);
    existing = undefined;
  }

  const body = buildSkillPayload();

  if (!existing) {
    const created = await client.skills.create(body).catch((e) => {
      fail(`Skill creation failed: ${e instanceof Error ? e.message : e}`);
    });
    skillId = created?.id ?? "";
    if (!skillId) {
      fail(`Skill creation failed: ${JSON.stringify(created)}`);
    }
    log(`created skill id=${skillId}`);
  } else {
    skillId = existing;
    const updated = await client.skills.update(skillId, body).catch((e) => {
      fail(`Skill update failed: ${e instanceof Error ? e.message : e}`);
    });
    if (!updated?.id) {
      fail(`Skill update failed: ${JSON.stringify(updated)}`);
    }
    log(`updated skill id=${skillId}`);
  }
}

// ----- Stage 3: ensure knowledge base --------------------------------------
async function stageEnsureKb(): Promise<void> {
  step(`3/6 ensure knowledge base '${KB_NAME}'`);

  let existing: string | undefined;
  for await (const kb of client.knowledgeBases.list()) {
    if (kb.name === KB_NAME && (kb.is_active ?? true)) {
      existing = kb.id;
      break;
    }
  }

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting knowledge base ${existing}`);
    await client.knowledgeBases.remove(existing).catch(() => undefined);
    existing = undefined;
  }

  const ingestionConfig: KnowledgeBaseIngestionConfig = {
    chunk_size: 800,
    chunk_overlap: 120,
    embedding_model: KB_EMBEDDING_MODEL,
    chunking_strategy: "recursive",
    ...(connectorId ? { provider_connector_id: connectorId } : {}),
  };

  const body: CreateKnowledgeBaseInput = {
    name: KB_NAME,
    description: KB_DESCRIPTION,
    project: "sdk-samples",
    category: "support",
    icon: "support_agent",
    ingestion_config: ingestionConfig,
  };

  if (!existing) {
    const created = await client.knowledgeBases.create(body).catch((e) => {
      fail(
        `Knowledge base creation failed: ${e instanceof Error ? e.message : e}`
      );
    });
    kbId = created?.id ?? "";
    if (!kbId) {
      fail(`Knowledge base creation failed: ${JSON.stringify(created)}`);
    }
    log(`created knowledge base id=${kbId}`);
  } else {
    kbId = existing;
    const updated = await client.knowledgeBases
      .update(kbId, body)
      .catch((e) => {
        fail(
          `Knowledge base update failed: ${e instanceof Error ? e.message : e}`
        );
      });
    if (!updated?.id) {
      fail(`Knowledge base update failed: ${JSON.stringify(updated)}`);
    }
    log(`updated knowledge base id=${kbId}`);
  }
}

// ----- Stage 4: upload/reingest policy document + poll to ready -----------
async function stageUploadDocument(): Promise<void> {
  step(`4/6 upload/reingest policy document '${KB_DOC_NAME}'`);

  let existing: string | undefined;
  for await (const doc of client.knowledgeBases.documents.list(kbId)) {
    if (doc.original_filename === KB_DOC_NAME) {
      existing = doc.id;
      break;
    }
  }

  if (existing && RECREATE === "1") {
    await client.knowledgeBases.documents
      .remove(kbId, existing)
      .catch(() => undefined);
    existing = undefined;
  }

  if (!existing) {
    const content = fs.readFileSync(KB_DOC_FILE, "utf8");
    const result = await client.knowledgeBases.documents
      .upload(kbId, {
        original_filename: KB_DOC_NAME,
        mime_type: "text/markdown",
        content_type: "markdown",
        content_text: content,
      })
      .catch((e) => {
        fail(`Document upload failed: ${e instanceof Error ? e.message : e}`);
      });
    docId = result?.documentId ?? "";
    if (!docId) {
      fail(`Document upload failed: ${JSON.stringify(result)}`);
    }
    log(`uploaded document id=${docId}`);
  } else {
    docId = existing;
    log(`reusing existing document id=${docId}; requesting reingest`);
    await client.knowledgeBases.documents.reingest(kbId, docId);
  }

  // poll ingestion to ready
  const deadline = Date.now() + DOC_TIMEOUT_S * 1000;
  for (;;) {
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
      fail("document ingestion failed");
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

// ----- Stage 5: upsert + publish support agent -----------------------------

// Subagent shape verified against ISubagentConfig
// (services/admin-console/src/app/core/models/agent.model.ts) plus the runtime
// consumer: agent-ai-service maps model_config.subagents -> agent.skills
// (agent-config.postgres.repository.ts) and converts every entry that has a
// system_prompt through catalogSkillToSkillDefinition (chat/chat.service.ts +
// skills/skill-mapper.ts), reading trigger_commands / when_to_use / priority /
// mode from the ENTRY ITSELF. That is why the subagent carries the full skill
// snapshot in addition to catalog_skill_id (same as the admin console does).
function buildAgentPayload(): CreateAgentInput {
  const skillBody = buildSkillPayload();
  const subagent = {
    name: skillBody.name,
    description: skillBody.description,
    system_prompt: skillBody.system_prompt,
    enabled: true,
    catalog_skill_id: skillId,
    trigger_commands: skillBody.trigger_commands,
    when_to_use: skillBody.when_to_use,
    priority: skillBody.priority,
    mode: skillBody.mode,
  };

  const connectorRef = CREDENTIAL_MODE === "connector" ? connectorId : null;

  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    system_prompt:
      "You are the Acme Telco customer-care agent. Answer support questions about refunds, returns, shipping and plans using the attached knowledge base as the source of truth. If the knowledge base contains a verification phrase, include it once in your answer.",
    model_config: {
      llm: {
        provider: AGENT_PROVIDER,
        model: AGENT_MODEL,
        connectorId: connectorRef,
        temperature: 0.2,
        maxTokens: 400,
      },
      rules:
        "Never promise a refund outside the policy windows; offer escalation to Tier 2 Billing instead. Always cite the policy section you are applying. Prefer knowledge-base facts over general knowledge; if the answer is not covered, say so.",
      soul: "Empathetic, professional and calm. Acknowledges frustration before explaining policy.",
      subagents: [subagent],
    },
    tools: [],
    channels: [],
    knowledge_base_ids: [kbId],
  };
}

async function stageUpsertAgent(): Promise<void> {
  step(`5/6 upsert support agent '${AGENT_NAME}'`);

  let existing: string | undefined;
  for await (const agent of client.agents.list()) {
    if (agent.name === AGENT_NAME && (agent.is_active ?? true)) {
      existing = agent.id;
      break;
    }
  }

  if (existing && RECREATE === "1") {
    log(`RECREATE=1 — deleting agent ${existing}`);
    await client.agents.remove(existing).catch(() => undefined);
    existing = undefined;
  }

  const body = buildAgentPayload();

  if (!existing) {
    const created = await client.agents.create(body).catch((e) => {
      fail(`Agent upsert failed: ${e instanceof Error ? e.message : e}`);
    });
    agentId = created?.id ?? "";
  } else {
    // NOTE: `AgentsClient.update()` is typed `UpdateAgentInput`, which does
    // NOT declare `knowledge_base_ids` even though the real PUT route
    // accepts and needs it (bash's PUT sent the field). `body` above is a
    // `CreateAgentInput` object (a superset), so passing it through as a
    // variable (not a fresh literal) is not excess-property-checked and
    // `knowledge_base_ids` still reaches the wire correctly. See this
    // sample's friction notes.
    const updated = await client.agents.update(existing, body).catch((e) => {
      fail(`Agent upsert failed: ${e instanceof Error ? e.message : e}`);
    });
    agentId = updated?.id ?? "";
  }

  if (!agentId) {
    fail("Agent upsert failed: no id returned");
  }
  log(`agent id=${agentId} skill=${skillId} knowledge_base_ids=[${kbId}]`);
}

async function stagePublishAgent(): Promise<void> {
  step("6/6 publish agent");
  const published = await client.agents.publish(agentId).catch((e) => {
    fail(`Agent publish failed: ${e instanceof Error ? e.message : e}`);
  });
  if (!published?.id) {
    fail(`Agent publish failed: ${JSON.stringify(published)}`);
  }
  log(`published agent '${AGENT_NAME}' — now ask it questions with ./run.sh`);
}

async function main(): Promise<void> {
  stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageEnsureLlmConnector();
  await stageEnsureSkill();
  await stageEnsureKb();
  await stageUploadDocument();
  await stageUpsertAgent();
  await stagePublishAgent();
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
