/**
 * 05-workflow — ensures the `crm-support-telegram` low-code orchestration
 * workflow: the visible-in-the-builder half of the demo (SPEC "Goal" #2).
 *
 * Adapted from `integrations/ai/ai-call-center-supervisor/src/setup.ts`
 * (`buildWorkflowBody`, ~line 917 — the exact `serviceCall` -> `jsFunction`
 * -> `agentCall` -> `conditional` -> `channelSend` action sequence and the
 * Telegram outbound `sendBase` shape) and
 * `demos/crm-support-telegram/src/0{1,2,3,4}-*.ts` (stage structure, lib
 * helpers, client bootstrap with the Host-header fetch wrapper, dedupe-by-
 * name idempotency pattern). Copied and adapted, NOT imported across trees
 * (`demos/README.md`).
 *
 * IMPORTANT deviation from the `ai-call-center-supervisor` reference (SPEC
 * "Prior art" note): that sample hardcodes `conversationId`/`userId` on its
 * `agentCall`. This workflow uses `{{request.from}}` for both instead, so
 * memory/skills stay scoped per real Telegram user.
 *
 * Action sequence (SPEC T06):
 *   trigger message_received (account-scoped `accountIds`, NEVER a shared
 *   unscoped trigger — an empty `accountIds` selection means "listen on any
 *   account" per `DOCS/workflows/engine.md`, which is exactly the e2e trace
 *   contamination lesson this avoids)
 *   -> endpointCall `searchContact` (demo-hubspot connector, search-contact
 *      endpoint, filtered on the `telegram_user_id` custom property, T03)
 *   -> jsFunction `normalizeContact` (extract the first match or mark
 *      contactKnown:false)
 *   -> serviceCall `scoreContact` (priority-scorer's POST /score, resolved
 *      by slug, T05)
 *   -> jsFunction `buildAgentContext` (renders the enriched CRM+score
 *      context block, prepended to the user's raw text, as the agent's
 *      message; also threads tier/score/reasons through to the conditional)
 *   -> agentCall `supportAgent` (crm-support-agent, T04; conversationId and
 *      userId are `{{request.from}}`)
 *   -> conditional `vipRoute` on `results.buildAgentContext.tier == "vip"`:
 *        VIP branch: jsFunction `buildEscalationReply` (prepends an
 *        escalation notice to the agent's reply) -> serviceCall
 *        `createTicket` (priority-scorer's POST /tickets, async
 *        HubSpot-ticket invoke, T05) -> channelSend reply
 *        default branch: channelSend reply (agent's raw reply)
 *
 * IDEMPOTENT: the workflow is matched and reconciled by `name`
 * (`crm-support-telegram`) — re-running never duplicates the workflow or its
 * trigger; any stale duplicate (a prior partial/failed run) is auto-healed
 * (kept: first, deleted: the rest), mirroring 02/03/04's dedupe pattern.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { Agent } from "@yoizen/platform-sdk/agents";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type { RegisteredService } from "@yoizen/platform-sdk/registry";
import type {
  CreateWorkflowInput,
  Workflow,
} from "@yoizen/platform-sdk/workflows";
import { fail } from "./lib/fail.js";
import { log, step, warn } from "./lib/logging.js";
import { requireEnv } from "./lib/require-env.js";
import { runStage } from "./lib/run-stage.js";

// ----- Configuration (override via env) -------------------------------------
const WORKFLOW_NAME = process.env.CRM_WORKFLOW_NAME ?? "crm-support-telegram";
const APPLICATION = process.env.CRM_WORKFLOW_APPLICATION ?? "crm-support";

const TG_ACCOUNT_NAME =
  process.env.TG_ACCOUNT_NAME ?? "CRM Support Telegram Bot";
const HUBSPOT_CONNECTOR_NAME = "demo-hubspot";
const HUBSPOT_SEARCH_CONTACT_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/objects/contacts/search",
};
const TELEGRAM_USER_ID_PROPERTY = "telegram_user_id";
const AGENT_NAME = process.env.CRM_AGENT_NAME ?? "crm-support-agent";
const SCORER_SERVICE_NAME =
  process.env.SCORER_SERVICE_NAME ?? "priority-scorer";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ----- jsFunction bodies ------------------------------------------------------
// Each is `(ctx) => {...}` — the same sandboxed-function shape as the
// TRIAGE_INPUT_CODE/DECIDE_CODE constants in
// integrations/ai/ai-call-center-supervisor/src/setup.ts. `ctx.request` is the
// trigger payload (`from`/`text` for a Telegram message_received event),
// `ctx.results.<actionName>` is the prior action's result (`.data` for
// endpointCall/serviceCall/agentCall).

// normalizeContact: reads the HubSpot search-contact response
// (`{ results: [{ id, properties }], total }`) and extracts the first match,
// or marks the contact unknown so downstream steps still have a stable shape.
const NORMALIZE_CONTACT_CODE = `(ctx) => {
  var req = ctx.request || {};
  var search = ctx.results.searchContact || {};
  var hits = (search.data && search.data.results) || [];
  var first = hits[0];
  if (first && first.id) {
    var props = first.properties || {};
    return {
      contactKnown: true,
      contactId: first.id,
      contactName: ((props.firstname || "") + " " + (props.lastname || "")).trim(),
      contactEmail: props.email || ""
    };
  }
  return {
    contactKnown: false,
    contactId: req.from || "unknown",
    contactName: "",
    contactEmail: ""
  };
}`;

// buildAgentContext: renders the CRM + priority-score enrichment block that
// is prepended to the user's raw text before it reaches the agent, and
// threads tier/score/reasons through to the conditional gateway.
const BUILD_AGENT_CONTEXT_CODE = `(ctx) => {
  var req = ctx.request || {};
  var contact = ctx.results.normalizeContact || {};
  var scoreResult = (ctx.results.scoreContact && ctx.results.scoreContact.data) || {};
  var tier = scoreResult.tier || "standard";
  var score = typeof scoreResult.score === "number" ? scoreResult.score : 0;
  var reasons = scoreResult.reasons || [];
  var lines = [];
  lines.push("[CRM CONTEXT]");
  lines.push("contact_known: " + (contact.contactKnown ? "yes" : "no"));
  if (contact.contactKnown) {
    lines.push("contact_name: " + contact.contactName);
    lines.push("contact_email: " + contact.contactEmail);
  }
  lines.push("priority_tier: " + tier);
  lines.push("priority_score: " + score);
  lines.push("priority_reasons: " + reasons.join(", "));
  lines.push("[/CRM CONTEXT]");
  var message = lines.join("\\n") + "\\n\\n" + (req.text || "");
  return { message: message, tier: tier, score: score, reasons: reasons };
}`;

// buildEscalationReply: only runs on the VIP branch. Prepends an escalation
// notice to the agent's reply — the reply text a human sees on Telegram.
const BUILD_ESCALATION_REPLY_CODE = `(ctx) => {
  var agent = ctx.results.supportAgent || {};
  var reply = (agent.data && agent.data.reply) || "";
  var text = "\\u26A0\\uFE0F VIP escalation \\u2014 a specialist will follow up shortly.\\n\\n" + reply;
  return { text: text };
}`;

async function main(): Promise<{
  workflowId: string;
  workflowName: string;
  telegramAccountId: string;
  hubspotConnectorId: string;
  searchContactEndpointId: string;
  agentId: string;
  scorerServiceId: string;
  triggerAccountIds: string[];
}> {
  // ----- Stage 1: preflight ---------------------------------------------------
  const { tenant, email, password, baseUrl, hostHeader } = await runStage(
    "preflight",
    async () => {
      const tenant = requireEnv("YOIZEN_TENANT");
      const email = requireEnv("YOIZEN_EMAIL");
      const password = requireEnv("YOIZEN_PASSWORD");
      const baseUrl = requireEnv("YOIZEN_BASE_URL");
      const hostHeader = process.env.YOIZEN_HOST_HEADER;
      log(
        `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  workflow=${WORKFLOW_NAME}`
      );
      return { tenant, email, password, baseUrl, hostHeader };
    }
  );

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

  // ----- Stage 2: resolve the Telegram account (T02) --------------------------
  const telegramAccountId = await runStage(
    `resolve telegram account '${TG_ACCOUNT_NAME}'`,
    async () => {
      const accounts: ChannelAccount[] = [];
      for await (const account of client.channels.listAccounts({
        channel: "telegram",
      })) {
        accounts.push(account);
      }
      const account = accounts.find(
        (a) => a.isActive && a.name === TG_ACCOUNT_NAME
      );
      if (!account) {
        fail(
          `telegram account '${TG_ACCOUNT_NAME}' not found — run 01-telegram-channel.sh first`
        );
      }
      log(`telegram account=${account.id}`);
      return account.id;
    }
  );

  // ----- Stage 3: resolve the demo-hubspot connector + search-contact (T03) ---
  const { hubspotConnectorId, searchContactEndpointId } = await runStage(
    `resolve connector '${HUBSPOT_CONNECTOR_NAME}' + search-contact endpoint`,
    async () => {
      const connectors: Connector[] = [];
      for await (const connector of client.connectors.list({
        context: "external",
      })) {
        connectors.push(connector);
      }
      const connector = connectors.find(
        (c) => c.name === HUBSPOT_CONNECTOR_NAME
      );
      if (!connector) {
        fail(
          `connector '${HUBSPOT_CONNECTOR_NAME}' not found — run 02-hubspot-connector.sh first`
        );
      }
      const searchEndpoint = connector.endpoints.find(
        (e) =>
          e.method === HUBSPOT_SEARCH_CONTACT_ENDPOINT.method &&
          e.path === HUBSPOT_SEARCH_CONTACT_ENDPOINT.path
      );
      if (!searchEndpoint) {
        fail(
          `connector '${HUBSPOT_CONNECTOR_NAME}' is missing the search-contact endpoint — run 02-hubspot-connector.sh first`
        );
      }
      log(
        `connector=${connector.id}  search-contact-endpoint=${searchEndpoint.id}`
      );
      return {
        hubspotConnectorId: connector.id,
        searchContactEndpointId: searchEndpoint.id,
      };
    }
  );

  // ----- Stage 4: resolve the published support agent (T04) -------------------
  const agentId = await runStage(`resolve agent '${AGENT_NAME}'`, async () => {
    let found: Agent | undefined;
    for await (const agent of client.agents.list({ pageSize: 100 })) {
      if (agent.name === AGENT_NAME) {
        found = agent;
        break;
      }
    }
    if (!found) {
      fail(`agent '${AGENT_NAME}' not found — run 03-ai-agent.sh first`);
    }
    log(`agent=${found.id}`);
    return found.id;
  });

  // ----- Stage 5: resolve the priority-scorer registered service (T05) --------
  const scorerServiceId = await runStage(
    `resolve registered service '${SCORER_SERVICE_NAME}'`,
    async () => {
      const services: RegisteredService[] = [];
      for await (const service of client.registry.services.list()) {
        services.push(service);
      }
      const service = services.find((s) => s.name === SCORER_SERVICE_NAME);
      if (!service) {
        fail(
          `registered service '${SCORER_SERVICE_NAME}' not found — run 04-priority-scorer.sh first`
        );
      }
      log(`scorer service=${service.id}`);
      return service.id;
    }
  );

  // ----- Stage 6: ensure the workflow -----------------------------------------
  const workflowId = await runStage(
    `ensure workflow '${WORKFLOW_NAME}'`,
    async () => {
      const sendBase = {
        accountId: telegramAccountId,
        channel: "telegram" as const,
        provider: "telegram" as const,
        to: "{{request.from}}",
        type: "text" as const,
      };

      const body: CreateWorkflowInput = {
        name: WORKFLOW_NAME,
        application: APPLICATION,
        actions: [
          {
            name: "searchContact",
            activity: "endpointCall",
            args: {
              method: "POST",
              url: "",
              adapterId: hubspotConnectorId,
              endpointId: searchContactEndpointId,
              data: {
                filterGroups: [
                  {
                    filters: [
                      {
                        propertyName: TELEGRAM_USER_ID_PROPERTY,
                        operator: "EQ",
                        value: "{{request.from}}",
                      },
                    ],
                  },
                ],
                limit: 1,
              },
            },
          },
          {
            name: "normalizeContact",
            activity: "jsFunction",
            args: { code: NORMALIZE_CONTACT_CODE },
          },
          {
            name: "scoreContact",
            activity: "serviceCall",
            args: {
              serviceId: scorerServiceId,
              serviceSlug: SCORER_SERVICE_NAME,
              method: "POST",
              path: "/score",
              data: { contactId: "{{results.normalizeContact.contactId}}" },
            },
          },
          {
            name: "buildAgentContext",
            activity: "jsFunction",
            args: { code: BUILD_AGENT_CONTEXT_CODE },
          },
          {
            name: "supportAgent",
            activity: "agentCall",
            args: {
              agentId,
              message: "{{results.buildAgentContext.message}}",
              // Real per-user scoping (SPEC "Prior art" deviation note) — NOT
              // hardcoded like the ai-call-center-supervisor reference.
              conversationId: "{{request.from}}",
              userId: "{{request.from}}",
              channel: "telegram",
            },
          },
          {
            name: "vipRoute",
            activity: "conditional",
            branches: [
              {
                label: "VIP escalation",
                condition: {
                  variable: "results.buildAgentContext.tier",
                  comparator: "eq",
                  value: "vip",
                },
                actions: [
                  {
                    name: "buildEscalationReply",
                    activity: "jsFunction",
                    args: { code: BUILD_ESCALATION_REPLY_CODE },
                  },
                  {
                    name: "createTicket",
                    activity: "serviceCall",
                    args: {
                      serviceId: scorerServiceId,
                      serviceSlug: SCORER_SERVICE_NAME,
                      method: "POST",
                      path: "/tickets",
                      data: {
                        // `{{workflow.tenant}}` — the ONLY tenant path in the
                        // execution context (`WorkflowExecutionContext.workflow`
                        // is `{ name, tenant, application }`,
                        // packages/shared/src/workflow.interfaces.ts:30). There
                        // is NO `workflow.tenantId`.
                        tenant: "{{workflow.tenant}}",
                        conversationId: "{{request.from}}",
                        // `{{executionId}}` — a context-ROOT field set per run
                        // by runWorkflow from `workflow_executions.id`
                        // (workflow.interfaces.ts:52, workflows.ts:925),
                        // unique per workflow execution. One execution == one
                        // conversational turn, so it gives create-ticket's
                        // idempotencyKey (`ticket-<tenant>-<conversationId>-
                        // <turn>`, priority-scorer/src/create-ticket.ts) a
                        // distinct per-turn value with no separate counter.
                        turn: "{{executionId}}",
                        ticket: {
                          properties: {
                            subject: "VIP escalation via Telegram support bot",
                            content: "{{request.text}}",
                            hs_ticket_priority: "HIGH",
                          },
                        },
                      },
                    },
                  },
                  {
                    name: "replyEscalated",
                    activity: "channelSend",
                    args: {
                      ...sendBase,
                      text: "{{results.buildEscalationReply.text}}",
                    },
                  },
                ],
              },
            ],
            default: [
              {
                name: "replyStandard",
                activity: "channelSend",
                args: {
                  ...sendBase,
                  text: "{{results.supportAgent.data.reply}}",
                },
              },
            ],
          },
        ],
        trigger: {
          type: "message_received",
          mode: "exclusive",
          config: {
            channels: ["telegram"],
            providers: ["telegram"],
            // Account-scoped ON PURPOSE — an empty `accountIds` means "listen
            // on any account" (`DOCS/workflows/engine.md`) and would let this
            // workflow fire on every Telegram account across every tenant
            // sample/demo, contaminating traces (engram lesson,
            // `demo/crm-telegram-showcase`).
            accountIds: [telegramAccountId],
          },
        },
      };

      const all: Workflow[] = [];
      for await (const workflow of client.workflows.list()) {
        if (workflow.name === WORKFLOW_NAME) {
          all.push(workflow);
        }
      }
      // API returns oldest-first; reverse so the first element is the newest.
      const matching = all.reverse();
      const keep = matching[0];
      const stale = matching.slice(1);

      for (const workflow of stale) {
        warn(
          `duplicate workflow '${WORKFLOW_NAME}' (${workflow.id}) — auto-healing, deleting`
        );
        await client.workflows.remove(workflow.id).catch(() => undefined);
      }

      if (keep) {
        const updated = await client.workflows
          .update(keep.id, body)
          .catch((e) => {
            fail(`workflow update FAILED: ${messageOf(e)}`);
          });
        log(`reuse  '${WORKFLOW_NAME}' — updated (id=${updated.id})`);
        return updated.id;
      }

      const created = await client.workflows.create(body).catch((e) => {
        fail(`workflow create FAILED: ${messageOf(e)}`);
      });
      log(`create '${WORKFLOW_NAME}' -> id=${created.id}`);
      return created.id;
    }
  );

  return {
    workflowId,
    workflowName: WORKFLOW_NAME,
    telegramAccountId,
    hubspotConnectorId,
    searchContactEndpointId,
    agentId,
    scorerServiceId,
    triggerAccountIds: [telegramAccountId],
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
      log(`workflow_id=${result.workflowId}`);
      log(`workflow_name=${result.workflowName}`);
      log(`telegram_account_id=${result.telegramAccountId}`);
      log(`hubspot_connector_id=${result.hubspotConnectorId}`);
      log(`search_contact_endpoint_id=${result.searchContactEndpointId}`);
      log(`agent_id=${result.agentId}`);
      log(`scorer_service_id=${result.scorerServiceId}`);
      log(`trigger_account_ids=${JSON.stringify(result.triggerAccountIds)}`);
    })
    .catch((e) => {
      fail(`05-workflow failed: ${e instanceof Error ? e.message : e}`);
    });
}

export { main };
