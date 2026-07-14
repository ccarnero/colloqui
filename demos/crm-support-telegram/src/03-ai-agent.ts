/**
 * 03-ai-agent — provisions the support agent for the crm-support-telegram
 * demo: LLM connector, knowledge base (5-8 seeded product FAQs), a custom
 * skill (order-status phrasing guide), system variables (company name, SLA
 * hours), per-user memory, and the published agent wiring all of them
 * together.
 *
 * Adapted from `sdk/samples/ai-knowledge-base-agent/src/setup.ts` (KB create
 * + document upload/reingest + poll-to-ready) and
 * `sdk/samples/ai-skill-support-agent/src/setup.ts` (custom skill create +
 * the `model_config.subagents` snapshot wiring) and
 * `sdk/samples/ai-system-variables/src/setup.ts` (system variable
 * upsert-by-name, value-preserving re-run semantics) and
 * `demos/crm-support-telegram/src/0{1,2}-*.ts` (stage structure, lib
 * helpers, client bootstrap with the Host-header fetch wrapper). Copied and
 * adapted, NOT imported across trees (`demos/README.md`).
 *
 * LLM connector: reuses the shared `sample-<provider>-llm` naming convention
 * from `sdk/samples/ai-agent-playground` (env: AI_AGENT_PROVIDER,
 * AI_AGENT_MODEL, AI_CREDENTIAL_MODE, AI_LLM_CONNECTOR_NAME) so this demo
 * reuses the SAME connector other samples already provisioned on the tenant
 * instead of creating a duplicate one.
 *
 * All other artifact names (KB, skill, agent, system variables) are demo-
 * specific and namespaced (CRM_*) on purpose: this demo does not read the
 * generic AI_AGENT_NAME/KB_NAME env vars that sibling SDK samples already use
 * for THEIR OWN agent/KB, to avoid silently renaming or reconfiguring an
 * unrelated sample's artifacts when all the `.env` files are sourced
 * together (see the loop's Environment section in
 * manual-loops/crm-support-telegram.md).
 *
 * Memory: per-user memory is the `memory` builtin tool (keyed by
 * `state.userId`), added to the agent's `tools` array — there is no separate
 * per-agent memory flag. The workflow's `agentCall` (T06) supplies a stable
 * per-customer `userId` (`{{request.from}}`).
 *
 * IDEMPOTENT: every artifact is create-or-update by name (connector, KB,
 * skill, agent) or by document filename (KB doc) or by name (system
 * variables, value preserved on re-run unless CRM_SYSVARS_RESET=1). The agent
 * is (re)published every run so it always ends PUBLISHED.
 *
 * Three platform gaps are worked around here (agent update KB field, skills
 * PATCH 500, KB ingestion-worker stalls). See manual-loops/crm-support-telegram.md
 * "Findings (T04 — platform/SDK gaps, escalated not patched)" for the full story.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { Agent, CreateAgentInput } from "@yoizen/platform-sdk/agents";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBaseIngestionConfig,
} from "@yoizen/platform-sdk/knowledge-bases";
import type {
  CreateSkillInput,
  Skill,
  SkillFile,
} from "@yoizen/platform-sdk/skills";
import type { SystemVariable } from "@yoizen/platform-sdk/system-variables";
import { fail } from "./lib/fail.js";
import { log, step, warn } from "./lib/logging.js";
import { requireEnv } from "./lib/require-env.js";
import { runStage } from "./lib/run-stage.js";

// ----- Configuration (override via env) -------------------------------------

// LLM connector — SHARED naming convention with other SDK AI samples so this
// demo reuses whatever connector they already provisioned on the tenant.
const AGENT_PROVIDER = process.env.AI_AGENT_PROVIDER ?? "openai";
const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "gpt-4o-mini";
const CREDENTIAL_MODE = process.env.AI_CREDENTIAL_MODE ?? "connector";
const LLM_CONNECTOR_NAME =
  process.env.AI_LLM_CONNECTOR_NAME ?? `sample-${AGENT_PROVIDER}-llm`;

// Demo-specific artifact names — namespaced (CRM_*) so sibling SDK samples'
// generic AI_AGENT_NAME/KB_NAME env vars never leak into this demo.
const KB_NAME = process.env.CRM_KB_NAME ?? "crm-support-faq-kb";
const KB_DESCRIPTION =
  process.env.CRM_KB_DESCRIPTION ??
  "Product FAQ knowledge base for the crm-support-telegram demo's support agent";
const KB_DOC_NAME = process.env.CRM_KB_DOC_NAME ?? "product-faq.md";
const KB_EMBEDDING_MODEL =
  process.env.CRM_KB_EMBEDDING_MODEL ?? "text-embedding-3-small";

const SKILL_NAME = process.env.CRM_SKILL_NAME ?? "order-status-phrasing-guide";

const AGENT_NAME = process.env.CRM_AGENT_NAME ?? "crm-support-agent";
const AGENT_DESCRIPTION =
  process.env.CRM_AGENT_DESCRIPTION ??
  "Support agent leading the crm-support-telegram demo's customer conversations, backed by a product FAQ knowledge base, an order-status phrasing skill and per-user memory";

const CRM_COMPANY_NAME = process.env.CRM_COMPANY_NAME ?? "Acme Support Co";
const CRM_SLA_HOURS = process.env.CRM_SLA_HOURS ?? "24";
const CRM_SYSVARS_RESET = process.env.CRM_SYSVARS_RESET ?? "0";

// 300s: KB ingestion-worker can stall for minutes. See SPEC Findings (T04).
const DOC_TIMEOUT_S = Number(process.env.CRM_DOC_TIMEOUT_S ?? "300");

// ----- Provider lookup tables (mirrors ai-knowledge-base-agent/ai-skill-support-agent) ---
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
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ----- The 6 seeded product FAQs (KB_NAME's single markdown document) ------
const PRODUCT_FAQ_MARKDOWN = `# Product FAQ

## What is your return policy?
Unopened items can be returned within 30 days of delivery for a full refund.
Opened items are eligible for a refund within 14 days, minus a 10% restocking
fee, unless the item arrived defective.

## How long does shipping take?
Standard shipping takes 3-5 business days. Expedited shipping takes 1-2
business days. International orders take 7-14 business days depending on
customs processing.

## How do I track my order?
Every order confirmation email includes a tracking link. You can also check
order status by messaging support with your order number.

## Do you offer a warranty?
All devices carry a 1-year manufacturer warranty covering defects in
materials and workmanship. Accidental damage and normal wear are not
covered.

## Can I change or cancel my order after placing it?
Orders can be changed or cancelled within 1 hour of placement, before they
enter fulfillment. After that window, the order ships as placed and must go
through the standard return process instead.

## What payment methods do you accept?
We accept all major credit cards, PayPal, and Apple Pay. Payment is
authorized at checkout and captured when the order ships.

## What if my item arrives damaged?
Contact support with your order number and a photo of the damage within 48
hours of delivery. We will ship a free replacement or issue a full refund,
your choice — no return of the damaged item is required.
`;

// ----- Order-status phrasing guide skill (attached via subagents) ----------
const ORDER_STATUS_PHRASING_CHEATSHEET = `# Order-status phrasing guide

- Never say "I don't know" about an order — say "let me check the latest
  status for you" and use the enriched CRM context if it is present in the
  conversation.
- Lead with the concrete state (e.g. "shipped", "processing", "delivered"),
  THEN the estimated date, in that order.
- If no order/context information is available in this conversation, ask the
  customer for their order number instead of guessing.
- Never invent a tracking number or delivery date — only report what was
  supplied in context; otherwise say the information is being retrieved and
  offer a specific next step (e.g. "I'll confirm and follow up within the
  SLA window").
- For delayed orders, acknowledge the delay explicitly before explaining next
  steps — do not bury the apology.
`;

function buildSkillPayload(): CreateSkillInput {
  const files: SkillFile[] = [
    {
      name: "order-status-phrasing.md",
      path: "reference/order-status-phrasing.md",
      type: "reference",
      content: ORDER_STATUS_PHRASING_CHEATSHEET,
    },
  ];

  return {
    name: SKILL_NAME,
    description:
      "Phrasing guide for communicating order status clearly and empathetically.",
    system_prompt:
      "You are the order-status phrasing expert. When a customer asks about an order, follow this order: (1) state the concrete current status; (2) then any estimated date; (3) never invent tracking numbers or dates that were not supplied in the conversation's context; (4) if the order is delayed, apologize before explaining next steps; (5) if no order context is present, ask for the order number rather than guessing.",
    icon: "local_shipping",
    color: "#42a5f5",
    trigger_commands: ["order status", "where is my order", "track order"],
    when_to_use:
      "Use when the customer asks about the status, location, or delivery estimate of an order.",
    priority: 10,
    allowed_tools: [],
    mode: "llm_driven",
    files,
  };
}

export interface AiAgentResult {
  connectorId: string;
  kbId: string;
  docId: string;
  skillId: string;
  companyNameVarId: string;
  slaHoursVarId: string;
  agentId: string;
  published: boolean;
}

export async function main(): Promise<AiAgentResult> {
  // ----- Stage 1: preflight -------------------------------------------------
  const { tenant, email, password, baseUrl, hostHeader } = await runStage(
    "preflight",
    async () => {
      const tenant = requireEnv("YOIZEN_TENANT");
      const email = requireEnv("YOIZEN_EMAIL");
      const password = requireEnv("YOIZEN_PASSWORD");
      const baseUrl = requireEnv("YOIZEN_BASE_URL");
      const hostHeader = process.env.YOIZEN_HOST_HEADER;

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
            `${keyVar} is required for AI_CREDENTIAL_MODE=connector. Put it in .env.`
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

      log(
        `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  llm_connector=${LLM_CONNECTOR_NAME}  kb=${KB_NAME}  skill=${SKILL_NAME}  agent=${AGENT_NAME}`
      );
      log(
        `system variables: crmSupportCompanyName='${CRM_COMPANY_NAME}'  crmSupportSlaHours='${CRM_SLA_HOURS}'  reset=${CRM_SYSVARS_RESET}`
      );
      return { tenant, email, password, baseUrl, hostHeader };
    }
  );

  // The gateway's dev ingress routes by Host header; the SDK's fetch-based
  // transport needs it passed as a regular header when talking to a bare
  // IP/localhost port (see 01-telegram-channel.ts / 02-hubspot-connector.ts).
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

  // ----- Stage 2: ensure the shared LLM connector ---------------------------
  const connectorId = await runStage(
    `ensure LLM connector '${LLM_CONNECTOR_NAME}'`,
    async () => {
      if (CREDENTIAL_MODE !== "connector") {
        log("credential mode=env — skipping connector provisioning");
        return "";
      }

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
      const matching = connectors.filter((c) => c.name === LLM_CONNECTOR_NAME);
      if (matching.length > 1) {
        warn(
          `duplicate connectors named '${LLM_CONNECTOR_NAME}' (${matching.length} found) — auto-healing, keeping first`
        );
        for (const stale of matching.slice(1)) {
          await client.connectors.remove(stale.id).catch(() => undefined);
        }
      }
      let id = matching[0]?.id ?? "";

      const body = {
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

      if (!id) {
        const created = await client.connectors.create(body).catch((e) => {
          fail(`Connector creation failed: ${messageOf(e)}`);
        });
        id = created?.id ?? "";
        if (!id) {
          fail(`Connector creation failed: ${JSON.stringify(created)}`);
        }
        log(`created connector id=${id} baseUrl=${connectorBaseUrl}`);
      } else {
        log(`reusing shared connector id=${id}`);
        await client.connectors
          .update(id, {
            baseUrl: body.baseUrl,
            authType: body.authType,
            authConfig: body.authConfig,
            timeoutMs: body.timeoutMs,
            maxRetries: body.maxRetries,
            retryBackoffMs: body.retryBackoffMs,
            tags: body.tags,
          })
          .catch((e) => {
            warn(`connector reconcile returned: ${messageOf(e)}`);
          });
      }
      return id;
    }
  );

  // ----- Stage 3: ensure the knowledge base ---------------------------------
  const kbId = await runStage(
    `ensure knowledge base '${KB_NAME}'`,
    async () => {
      const knowledgeBases: KnowledgeBase[] = [];
      for await (const kb of client.knowledgeBases.list()) {
        knowledgeBases.push(kb);
      }
      const existing = knowledgeBases.find(
        (kb) => kb.name === KB_NAME && (kb.is_active ?? true)
      );

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
        project: "demos",
        category: "support",
        icon: "support_agent",
        ingestion_config: ingestionConfig,
      };

      if (!existing) {
        const created = await client.knowledgeBases.create(body).catch((e) => {
          fail(`Knowledge base creation failed: ${messageOf(e)}`);
        });
        const id = created?.id ?? "";
        if (!id) {
          fail(`Knowledge base creation failed: ${JSON.stringify(created)}`);
        }
        log(`created knowledge base id=${id}`);
        return id;
      }

      const updated = await client.knowledgeBases
        .update(existing.id, body)
        .catch((e) => {
          fail(`Knowledge base update failed: ${messageOf(e)}`);
        });
      if (!updated?.id) {
        fail(`Knowledge base update failed: not found (id=${existing.id})`);
      }
      log(`updated knowledge base id=${updated.id}`);
      return updated.id;
    }
  );

  // ----- Stage 4: upload/reingest the FAQ document + poll to ready ---------
  const docId = await runStage(
    `upload/reingest document '${KB_DOC_NAME}'`,
    async () => {
      const documents: KnowledgeBaseDocument[] = [];
      for await (const doc of client.knowledgeBases.documents.list(kbId)) {
        documents.push(doc);
      }
      const existing = documents.find(
        (d) => d.original_filename === KB_DOC_NAME
      );

      let id: string;
      if (!existing) {
        const result = await client.knowledgeBases.documents
          .upload(kbId, {
            content_text: PRODUCT_FAQ_MARKDOWN,
            original_filename: KB_DOC_NAME,
            mime_type: "text/markdown",
            content_type: "markdown",
          })
          .catch((e) => {
            fail(`Document upload failed: ${messageOf(e)}`);
          });
        id = result?.documentId ?? "";
        if (!id) {
          fail(`Document upload failed: ${JSON.stringify(result)}`);
        }
        log(`uploaded document id=${id}`);
      } else if (
        existing.status === "ready" &&
        existing.content_text === PRODUCT_FAQ_MARKDOWN
      ) {
        // Ready + unchanged content: skip reingest (nothing to re-embed) to
        // avoid the KB ingestion-worker stall. CRM_KB_DOC_FORCE_REINGEST=1
        // forces it. See SPEC Findings (T04).
        id = existing.id;
        log(
          `reusing existing document id=${id} — already ready with unchanged content, skipping reingest`
        );
        if (process.env.CRM_KB_DOC_FORCE_REINGEST === "1") {
          log("CRM_KB_DOC_FORCE_REINGEST=1 — forcing reingest anyway");
          await client.knowledgeBases.documents.reingest(kbId, id);
        } else {
          log(`document ready chunks=${existing.chunk_count}`);
          return id;
        }
      } else {
        id = existing.id;
        log(`reusing existing document id=${id}; requesting reingest`);
        await client.knowledgeBases.documents.reingest(kbId, id);
      }

      const deadline = Date.now() + DOC_TIMEOUT_S * 1000;
      for (;;) {
        const doc = await client.knowledgeBases.documents.get(kbId, id);
        const status = doc?.status ?? "";
        const chunks = doc?.chunk_count ?? 0;
        if (status === "ready") {
          log(`document ready chunks=${chunks}`);
          return id;
        }
        if (status === "failed") {
          fail(`document ${id} failed to ingest: ${JSON.stringify(doc)}`);
        }
        if (status === "pending" || status === "processing" || status === "") {
          if (Date.now() >= deadline) {
            fail(
              `timed out waiting for document ${id}; last status=${status || "unknown"}`
            );
          }
          await sleep(3);
          continue;
        }
        warn(`unknown document status '${status}', continuing`);
        await sleep(3);
      }
    }
  );

  // ----- Stage 5: ensure the order-status phrasing skill --------------------
  const skillId = await runStage(
    `ensure catalog skill '${SKILL_NAME}'`,
    async () => {
      const skills: Skill[] = [];
      for await (const skill of client.skills.list()) {
        skills.push(skill);
      }
      const existing = skills.find(
        (s) => s.name === SKILL_NAME && (s.is_active ?? true)
      );

      const body = buildSkillPayload();

      if (!existing) {
        const created = await client.skills.create(body).catch((e) => {
          fail(`Skill creation failed: ${messageOf(e)}`);
        });
        const id = created?.id ?? "";
        if (!id) {
          fail(`Skill creation failed: ${JSON.stringify(created)}`);
        }
        log(`created skill id=${id}`);
        return id;
      }

      // PATCH /admin/skills/:id returns 500; skill payload is static so
      // reuse-by-name is idempotent. See SPEC Findings (T04).
      log(`reusing existing skill id=${existing.id} (skipping PATCH)`);
      return existing.id;
    }
  );

  // ----- Stage 6: ensure the company-name + SLA-hours system variables -----
  async function findSystemVariableByName(
    name: string
  ): Promise<SystemVariable | undefined> {
    for await (const variable of client.systemVariables.list({
      pageSize: 100,
    })) {
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
      if (CRM_SYSVARS_RESET === "1" && existingValue !== value) {
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
          `keeping variable ${name} (id=${existing.id}) value='${existingValue}' (CRM_SYSVARS_RESET=1 to overwrite)`
        );
      }
      return existing.id;
    }

    const created = await client.systemVariables
      .create({ name, type: "string", value, label, description })
      .catch((e) => {
        fail(`system variable '${name}' creation failed: ${messageOf(e)}`);
      });
    if (!created?.id) {
      fail(
        `system variable '${name}' creation failed: ${JSON.stringify(created)}`
      );
    }
    log(`created variable ${name} (id=${created.id}) value='${value}'`);
    return created.id;
  }

  const { companyNameVarId, slaHoursVarId } = await runStage(
    "ensure system variables (crmSupportCompanyName, crmSupportSlaHours)",
    async () => {
      const companyNameVarId = await ensureSystemVariable(
        "crmSupportCompanyName",
        CRM_COMPANY_NAME,
        "Support company name",
        "Brand name the support agent uses to introduce itself (demos/crm-support-telegram)"
      );
      const slaHoursVarId = await ensureSystemVariable(
        "crmSupportSlaHours",
        CRM_SLA_HOURS,
        "Support SLA (hours)",
        "SLA in hours the support agent cites for follow-ups/escalations (demos/crm-support-telegram)"
      );
      return { companyNameVarId, slaHoursVarId };
    }
  );

  // ----- Stage 7: upsert + publish the support agent ------------------------
  // System prompt (SPEC "constraints"): the agent LEADS the conversation, not
  // passive intent routing; it receives an enriched CONTEXT block (HubSpot
  // contact + priority score {score, tier, reasons[]}) prepended by the
  // workflow (T06) ahead of the customer's own message; it adapts tone for
  // tier === "vip"; company name + SLA hours resolve from system variables
  // at execution time via agent-ai-service's template renderer.
  const SYSTEM_PROMPT = `You are the lead support agent for {{variables.system.crmSupportCompanyName}}, driving a live Telegram support conversation end to end — you are NOT a passive intent router waiting to be told what to do.

Every inbound customer message you receive is prefixed with a CONTEXT block assembled by the support workflow, shaped like:
  Context: { "contact": { ...HubSpot contact fields... }, "priority": { "score": <number>, "tier": "standard"|"vip", "reasons": [<string>, ...] } }
Followed by the customer's own message text. Use that context to personalize your reply (name, known history, priority reasons) — never quote the raw JSON back to the customer, and never invent contact or priority details that were not supplied.

Tone:
- Default: professional, warm, concise.
- When priority.tier == "vip": shift to a more formal, escalation-aware tone — acknowledge the urgency implied by the priority reasons, avoid casual language, and proactively offer a fast path to a human agent if the issue is not fully resolved in this reply.

Cite the current SLA of {{variables.system.crmSupportSlaHours}} hours only when relevant (delays, escalations, or when explicitly asked "how long will this take").

Lead the conversation: ask clarifying questions when the request is ambiguous, use the attached knowledge base for product/policy facts, and use the order-status-phrasing-guide skill whenever the customer asks about an order's status. You have access to per-user memory — use it to recall facts this same customer told you in earlier turns (their preferences, open issues already discussed), and store new durable facts worth remembering across conversations.`;

  function buildAgentBody(): CreateAgentInput {
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

    return {
      name: AGENT_NAME,
      description: AGENT_DESCRIPTION,
      system_prompt: SYSTEM_PROMPT,
      model_config: {
        llm: {
          provider: AGENT_PROVIDER,
          model: AGENT_MODEL,
          connectorId: CREDENTIAL_MODE === "connector" ? connectorId : null,
          temperature: 0.3,
          maxTokens: 500,
        },
        rules:
          "Prefer knowledge-base facts over general knowledge; if the answer is not covered, say so plainly. Never promise dates/tracking numbers not present in the supplied context. Escalate VIP-tier customers proactively when an issue cannot be resolved immediately.",
        soul: "Warm, professional, proactive — leads the conversation instead of waiting to be asked.",
        subagents: [subagent],
      },
      tools: [
        {
          name: "loadSkill",
          description:
            "Built-in tool enabled so the order-status-phrasing-guide subagent skill is reachable at runtime.",
          source_type: "builtin",
          builtin: true,
        },
        {
          name: "memory",
          description:
            "Built-in tool enabled for per-user memory: read/store/search facts about the current customer (state.userId) across conversations.",
          source_type: "builtin",
          builtin: true,
        },
      ],
      channels: [],
      knowledge_base_ids: [kbId],
    };
  }

  const agentId = await runStage(
    `upsert support agent '${AGENT_NAME}'`,
    async () => {
      const agents: Agent[] = [];
      for await (const agent of client.agents.list({ pageSize: 100 })) {
        if (agent.name === AGENT_NAME && (agent.is_active ?? true)) {
          agents.push(agent);
          break;
        }
      }
      const existingId = agents[0]?.id ?? "";
      const body = buildAgentBody();

      let agent: Agent | undefined;
      if (existingId) {
        // Gateway UpdateAgentDto lacks knowledge_base_ids (400 on update) —
        // KB set at CREATE only, omitted here. See SPEC Findings (T04).
        const { knowledge_base_ids: _omittedOnUpdate, ...updateBody } = body;
        agent = await client.agents
          .update(existingId, updateBody)
          .catch((e) => {
            fail(`Agent upsert failed: ${messageOf(e)}`);
          });
      } else {
        agent = await client.agents.create(body).catch((e) => {
          fail(`Agent upsert failed: ${messageOf(e)}`);
        });
      }
      if (!agent?.id) {
        fail(`Agent upsert failed: ${JSON.stringify(agent)}`);
      }
      log(
        `agent id=${agent.id} skill=${skillId} knowledge_base_ids=[${kbId}] tools=[loadSkill,memory]`
      );
      return agent.id;
    }
  );

  // ----- Stage 8: publish the agent ------------------------------------------
  const published = await runStage(
    `publish agent '${AGENT_NAME}'`,
    async () => {
      const result = await client.agents.publish(agentId).catch((e) => {
        fail(`Agent publish failed: ${messageOf(e)}`);
      });
      if (!result?.id) {
        fail(`Agent publish failed: ${JSON.stringify(result)}`);
      }
      log(`published agent '${AGENT_NAME}' (id=${agentId})`);
      return true;
    }
  );

  return {
    connectorId,
    kbId,
    docId,
    skillId,
    companyNameVarId,
    slaHoursVarId,
    agentId,
    published,
  };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .then((result) => {
      console.log();
      step("resolved artifacts");
      log(`connector_id=${result.connectorId}`);
      log(`kb_id=${result.kbId}`);
      log(`doc_id=${result.docId}`);
      log(`skill_id=${result.skillId}`);
      log(`company_name_var_id=${result.companyNameVarId}`);
      log(`sla_hours_var_id=${result.slaHoursVarId}`);
      log(`agent_id=${result.agentId}`);
      log(`agent_published=${result.published}`);
    })
    .catch((e) => {
      fail(`03-ai-agent failed: ${e instanceof Error ? e.message : e}`);
    });
}
