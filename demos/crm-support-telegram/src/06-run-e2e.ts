/**
 * 06-run-e2e — the end-to-end proof for the crm-support-telegram demo (SPEC
 * T07, run via `./run.sh`). Resolves every artifact 01-05 provisioned (by
 * name/slug, like `05-workflow.ts`), seeds a standard-then-VIP HubSpot
 * contact, drives two simulated Telegram inbound messages through the real
 * workflow, polls the workflow-execution API for each completed run, and
 * asserts on the SAME action-result context the admin-console run-view
 * shows a human — then cleans up every HubSpot artifact it created and
 * prints the run-view URL for the demo's money shot.
 *
 * Adapted from `demos/crm-support-telegram/src/0{1,2,4,5}-*.ts` (stage
 * structure, lib helpers, client bootstrap with the Host-header fetch
 * wrapper, locally-mirrored connector-invoke types — SDK gap, T03) and
 * `integrations/channels/telegram-transform-reply/src/setup.ts`'s `simulateInbound()`
 * (the `client.webhooks.ingest()` call + execution-polling loop this stage
 * generalizes to two runs with real assertions). Copied and adapted, NOT
 * imported across trees (`demos/README.md`).
 *
 * ----------------------------------------------------------------------
 * DESIGN NOTES / DEVIATIONS FROM THE SPEC'S LITERAL WORDING (see
 * manual-loops/crm-support-telegram.md "Findings (T07)" for the full
 * writeup; short versions here, next to the code they explain):
 *
 * 1. Simulated inbound via `client.webhooks.ingest()`, not a raw `fetch`
 *    POST to `TG_PUBLIC_URL`. The SPEC allowed either ("or a real Telegram
 *    message"); `telegram-transform-reply`'s proven pattern hits the
 *    platform's OWN gateway route (`POST /api/webhooks/telegram/:tenant/
 *    :instance`, `services/api-gateway/src/modules/channels/
 *    webhooks.controller.ts`) directly via the SDK, with the SAME
 *    `x-telegram-bot-api-secret-token` signature verification
 *    (`services/channel-service/.../telegram.provider.ts`,
 *    `webhook-ingress.service.ts` `resolveAccount()`) a real Telegram
 *    delivery would exercise. It is MORE reliable for an automated E2E
 *    script than depending on the `TG_PUBLIC_URL` tunnel's uptime — that
 *    tunnel path is already covered by `01-telegram-channel.sh`'s
 *    `webhook_registered` assertion (enforced as a hard failure by
 *    `setup.sh`).
 *
 * 2. "Contact searched (cache miss then hit on second message)" is NOT
 *    assertable on the `searchContact` workflow action: T03 made
 *    `search-contact` explicitly UNCACHED ("search results must always
 *    reflect the latest contact state" — `02-hubspot-connector.ts`). The
 *    cacheable HubSpot reads (`list-deals-by-contact`/
 *    `list-tickets-by-contact`, 60s TTL, `readCacheStrategy`) are called
 *    from INSIDE `priority-scorer`'s own process
 *    (`priority-scorer/src/hubspot-associations.ts`), never as a workflow
 *    action — so their `cacheResult` is invisible to
 *    `workflows.getExecution()` and there is no invocationId surfaced back
 *    to the workflow/caller to poll via `connectors.invocations.get()`
 *    either. This stage instead demonstrates the SAME cache mechanism
 *    directly and honestly: two back-to-back sync `connectors.invoke()`
 *    calls of `list-deals-by-contact` for the seeded contact (the EXACT
 *    endpoint + cache strategy the scorer itself uses), asserting
 *    miss-then-hit on `cacheResult` — see `stageCacheProbe()`.
 *
 * 3. "Reply delivered" is asserted as "reply publish CONFIRMED", not
 *    "Telegram accepted it": `channelSend`'s local activity
 *    (`services/workflow-service/src/temporal/activities/
 *    channel-send.activity.ts`) publishes a fire-and-forget NATS command
 *    and returns `{ published: true, subject }` — actual Telegram delivery
 *    happens asynchronously in channel-service and is not surfaced back
 *    into the workflow execution context at all. This stage asserts on
 *    what `getExecution()` ACTUALLY returns (`published === true`) and
 *    documents the gap rather than claiming a delivery guarantee the
 *    platform doesn't expose.
 *
 * 4. VIP ticket cleanup identifies the ticket by the `invocationId`
 *    `results.createTicket.data.invocationId` returns (SPEC T07 point 5 —
 *    poll `connectors.invocations.get()`), NOT by an "[E2E]"-tagged ticket
 *    subject. `05-workflow.ts`'s ticket `subject` is a fixed, already
 *    gate-passed (T06) production string with no template variable this
 *    script can hook — subject-tagging it would either permanently prefix
 *    every REAL VIP ticket a production run creates, or require re-editing
 *    and re-verifying a shipped T06 artifact against the live cluster,
 *    which this task is explicitly not allowed to execute (human boundary,
 *    see the task instructions). Resolving the exact HubSpot object id via
 *    the invocation's own result is a STRICTER identification method than
 *    a subject substring match — it points at precisely the object this
 *    run created, immune to both false positives and false negatives — so
 *    cleanup stays fully within the SPEC's "delete every artifact it
 *    creates" intent. The CONTACT and VIP DEALS this script seeds directly
 *    (not through the workflow) ARE "[E2E]"-tagged in `firstname`/
 *    `dealname`, as the SPEC intends, since this script fully controls
 *    those payloads.
 * ----------------------------------------------------------------------
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@yoizen/platform-sdk";
import type { Agent } from "@yoizen/platform-sdk/agents";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type { RegisteredService } from "@yoizen/platform-sdk/registry";
import type {
  Workflow,
  WorkflowExecutionListItem,
} from "@yoizen/platform-sdk/workflows";
import { fail } from "./lib/fail.js";
import { err, log, step, warn } from "./lib/logging.js";
import { requireEnv } from "./lib/require-env.js";
import { runStage } from "./lib/run-stage.js";

// NOTE (SDK gap, T03/T05 — not patched): connector-invoke result types
// aren't re-exported by `@yoizen/platform-sdk/connectors`, so the minimal
// shapes this script needs are mirrored locally, same as
// `02-hubspot-connector.ts` / `priority-scorer/src/hubspot-associations.ts`.
interface HubspotSyncInvokeResult {
  invocationId: string;
  status: number;
  data: unknown;
  headers: Record<string, string>;
  cacheResult?: "hit" | "miss" | "bypass" | null;
}
interface HubspotAsyncInvokeAccepted {
  invocationId: string;
}
interface HubspotInvocationPending {
  invocationId: string;
  status: "pending";
}
interface HubspotInvocationCompleted {
  invocationId: string;
  status: "completed";
  outcome: "ok" | "error";
  result?: {
    status: number;
    data: unknown;
    headers: Record<string, string>;
    cacheResult?: "hit" | "miss" | "bypass" | null;
  };
  error?: { kind: string; message: string };
}
type HubspotInvocationStatus =
  | HubspotInvocationPending
  | HubspotInvocationCompleted;

// The COMPLETED-execution `result` field is the raw `WorkflowExecutionContext`
// (`packages/shared/src/workflow.interfaces.ts:29-53`) — `workflows.service.ts`
// `getExecutionStatus()` returns `handle.result()` verbatim on `status ===
// "COMPLETED"` (`services/workflow-service/src/modules/workflows/
// workflows.service.ts:761-762`). The SDK's `ExecutionStatusResult.result` is
// typed `unknown` (it never re-derives the shared workflow types), so this is
// a locally-typed, loose mirror — read via the narrowing helpers below, never
// trusted blindly.
interface RunResultContext {
  workflow?: { name?: string; tenant?: string; application?: string };
  request?: Record<string, unknown>;
  results?: Record<string, unknown>;
  executionId?: string;
}

// ----- Configuration (override via env) -------------------------------------
const WORKFLOW_NAME = process.env.CRM_WORKFLOW_NAME ?? "crm-support-telegram";
const TG_ACCOUNT_NAME =
  process.env.TG_ACCOUNT_NAME ?? "CRM Support Telegram Bot";
const HUBSPOT_CONNECTOR_NAME = "demo-hubspot";
const AGENT_NAME = process.env.CRM_AGENT_NAME ?? "crm-support-agent";
const SCORER_SERVICE_NAME =
  process.env.SCORER_SERVICE_NAME ?? "priority-scorer";
const TELEGRAM_USER_ID_PROPERTY = "telegram_user_id";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const E2E_TAG = "[E2E]";

// Matches `OPEN_DEAL_VALUE_VIP_THRESHOLD` in `priority-scorer/src/score.ts`
// (read per the task instructions) — the scorer marks a contact VIP once its
// associated OPEN-deal COUNT reaches this many (T05's DATA-AVAILABILITY gap:
// deal count is a proxy for deal value, no `amount` property is fetched).
// Seeding exactly this many deals is the deterministic way to cross the VIP
// threshold without depending on real deal amounts.
const VIP_DEAL_COUNT = 3;

// Matches `02-hubspot-connector.ts`'s `HUBSPOT_CACHE_TTL_SECONDS` default —
// the read-cache TTL on `list-deals-by-contact`/`list-tickets-by-contact`.
const HUBSPOT_CACHE_TTL_SECONDS = Number(
  process.env.HUBSPOT_CACHE_TTL_SECONDS ?? "60"
);

const EXECUTION_POLL_TIMEOUT_S = Number(
  process.env.CRM_E2E_POLL_TIMEOUT_S ?? "120"
);
const INVOCATION_POLL_TIMEOUT_S = Number(
  process.env.CRM_E2E_INVOCATION_POLL_TIMEOUT_S ?? "60"
);

const HUBSPOT_DEALS_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/associations/contacts/deals/batch/read",
};
const HUBSPOT_TICKETS_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/associations/contacts/tickets/batch/read",
};
const HUBSPOT_SEARCH_CONTACT_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/objects/contacts/search",
};
const HUBSPOT_CREATE_CONTACT_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/objects/contacts",
};

// Same cache files 01-telegram-channel.ts writes — reused here read-only so
// this script never re-implements chat-id discovery or webhook-secret
// capture, it just resolves what 01 already resolved.
const demoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHAT_ID_CACHE_FILE = path.join(demoDir, ".telegram-test-chat-id");
const SECRET_FILE = path.join(demoDir, ".telegram-channel-secret");

function loadFromFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : undefined;
}

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}
function record(checks: Check[], label: string, pass: boolean, detail = "") {
  const status = pass ? "PASS" : "FAIL";
  const line = `[${status}] ${label}${detail ? ` — ${detail}` : ""}`;
  if (pass) {
    log(line);
  } else {
    err(line);
  }
  checks.push({ label, pass, detail });
}

// ----- HubSpot direct-fetch helpers ------------------------------------------
// Deal create/associate/delete and ticket/contact delete have NO connector
// endpoint (T03 only provisioned search/create-contact, list-by-contact
// reads, and create-ticket) — per the task instructions, a direct fetch to
// api.hubapi.com with HUBSPOT_SERVICE_KEY is the documented, acceptable way
// to seed/clean up E2E-only HubSpot data.
function hubspotFetch(
  hubspotServiceKey: string,
  urlPath: string,
  init: { method: string; body?: unknown }
): Promise<Response> {
  return fetch(`${HUBSPOT_API_BASE}${urlPath}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${hubspotServiceKey}`,
      "Content-Type": "application/json",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function hubspotDelete(
  hubspotServiceKey: string,
  urlPath: string,
  label: string
): Promise<void> {
  try {
    const resp = await hubspotFetch(hubspotServiceKey, urlPath, {
      method: "DELETE",
    });
    if (resp.ok || resp.status === 404) {
      log(`  cleanup: deleted ${label} (HTTP ${resp.status})`);
    } else {
      const body = await resp.text();
      warn(`  cleanup: FAILED to delete ${label}: HTTP ${resp.status} ${body}`);
    }
  } catch (e) {
    warn(`  cleanup: FAILED to delete ${label}: ${messageOf(e)}`);
  }
}

// ----- Synthetic Telegram update ---------------------------------------------
// Same shape `telegram-transform-reply/src/setup.ts`'s `simulateInbound()`
// builds, parsed by `TelegramProvider.parseTelegramMessage()`
// (`services/channel-service/src/providers/telegram/telegram.provider.ts`).
function buildTelegramUpdate(chatId: number, text: string): unknown {
  return {
    update_id: Math.floor(Date.now() / 1000),
    message: {
      message_id: Math.floor(Math.random() * 1_000_000),
      date: Math.floor(Date.now() / 1000),
      from: { id: chatId, is_bot: false, first_name: "E2E" },
      chat: { id: chatId, type: "private" },
      text,
    },
  };
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  const cleanup = {
    contactId: undefined as string | undefined,
    dealIds: [] as string[],
    ticketId: undefined as string | undefined,
  };

  const runCleanup = async (hubspotServiceKey: string): Promise<void> => {
    step("cleanup: deleting HubSpot artifacts this run created");
    if (cleanup.ticketId) {
      await hubspotDelete(
        hubspotServiceKey,
        `/crm/v3/objects/tickets/${cleanup.ticketId}`,
        `ticket ${cleanup.ticketId}`
      );
    }
    for (const dealId of cleanup.dealIds) {
      await hubspotDelete(
        hubspotServiceKey,
        `/crm/v3/objects/deals/${dealId}`,
        `deal ${dealId}`
      );
    }
    if (cleanup.contactId) {
      await hubspotDelete(
        hubspotServiceKey,
        `/crm/v3/objects/contacts/${cleanup.contactId}`,
        `contact ${cleanup.contactId}`
      );
    }
    log(
      "cleanup: done (platform artifacts — channel/connector/agent/workflow/service — are NOT torn down, they ARE the demo)"
    );
  };

  // Trap-guarded: Node has no bash `trap`, so SIGINT/SIGTERM handlers are the
  // idiomatic equivalent — cleanup runs even if the human Ctrl-C's a stuck
  // poll loop. `hubspotServiceKey` is captured once preflight resolves it.
  let hubspotServiceKeyForSignals: string | undefined;
  const onSignal = (sig: string) => {
    warn(`received ${sig} — running cleanup before exit`);
    void (async () => {
      if (hubspotServiceKeyForSignals) {
        await runCleanup(hubspotServiceKeyForSignals);
      }
      process.exit(130);
    })();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  try {
    // ----- Stage 1: preflight ---------------------------------------------
    const { tenant, email, password, baseUrl, hostHeader, hubspotServiceKey } =
      await runStage("preflight", async () => {
        const tenant = requireEnv("YOIZEN_TENANT");
        const email = requireEnv("YOIZEN_EMAIL");
        const password = requireEnv("YOIZEN_PASSWORD");
        const baseUrl = requireEnv("YOIZEN_BASE_URL");
        const hubspotServiceKey = requireEnv("HUBSPOT_SERVICE_KEY");
        const hostHeader = process.env.YOIZEN_HOST_HEADER;
        log(`YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}`);
        return {
          tenant,
          email,
          password,
          baseUrl,
          hostHeader,
          hubspotServiceKey,
        };
      });
    hubspotServiceKeyForSignals = hubspotServiceKey;

    const testChatIdRaw =
      process.env.TELEGRAM_TEST_CHAT_ID ||
      process.env.TELEGRAM_CHAT_ID ||
      loadFromFile(CHAT_ID_CACHE_FILE);
    if (!testChatIdRaw) {
      fail(
        "TELEGRAM_TEST_CHAT_ID could not be resolved — run ./setup.sh (01-telegram-channel.sh) first, or set it explicitly."
      );
    }
    const testChatId = Number(testChatIdRaw);
    if (!Number.isFinite(testChatId)) {
      fail(`TELEGRAM_TEST_CHAT_ID is not numeric: '${testChatIdRaw}'`);
    }

    const appSecret = loadFromFile(SECRET_FILE);
    if (!appSecret) {
      fail(
        "no cached Telegram webhook secret found (.telegram-channel-secret) — run ./setup.sh (01-telegram-channel.sh) first."
      );
    }

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

    // ----- Stage 2: resolve every artifact 01-05 provisioned ---------------
    const telegram = await runStage(
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
            `telegram account '${TG_ACCOUNT_NAME}' not found — run ./setup.sh (01-telegram-channel.sh) first`
          );
        }
        log(`telegram account=${account.id} externalId=${account.externalId}`);
        return { accountId: account.id, externalId: account.externalId };
      }
    );

    const hubspot = await runStage(
      `resolve connector '${HUBSPOT_CONNECTOR_NAME}' + endpoints`,
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
            `connector '${HUBSPOT_CONNECTOR_NAME}' not found — run ./setup.sh (02-hubspot-connector.sh) first`
          );
        }
        const findEndpoint = (target: { method: string; path: string }) =>
          connector.endpoints.find(
            (e) => e.method === target.method && e.path === target.path
          );
        const search = findEndpoint(HUBSPOT_SEARCH_CONTACT_ENDPOINT);
        const create = findEndpoint(HUBSPOT_CREATE_CONTACT_ENDPOINT);
        const deals = findEndpoint(HUBSPOT_DEALS_ENDPOINT);
        const tickets = findEndpoint(HUBSPOT_TICKETS_ENDPOINT);
        if (!search || !create || !deals || !tickets) {
          fail(
            `connector '${HUBSPOT_CONNECTOR_NAME}' is missing a required endpoint — run ./setup.sh (02-hubspot-connector.sh) first`
          );
        }
        log(
          `connector=${connector.id}  search=${search.id}  create=${create.id}  deals=${deals.id}  tickets=${tickets.id}`
        );
        return {
          connectorId: connector.id,
          searchContactEndpointId: search.id,
          createContactEndpointId: create.id,
          dealsEndpointId: deals.id,
          ticketsEndpointId: tickets.id,
        };
      }
    );

    await runStage(
      `resolve agent '${AGENT_NAME}' (published check)`,
      async () => {
        let found: Agent | undefined;
        for await (const agent of client.agents.list({ pageSize: 100 })) {
          if (agent.name === AGENT_NAME) {
            found = agent;
            break;
          }
        }
        if (!found) {
          fail(
            `agent '${AGENT_NAME}' not found — run ./setup.sh (03-ai-agent.sh) first`
          );
        }
        log(`agent=${found.id}`);
        return found.id;
      }
    );

    await runStage(
      `resolve registered service '${SCORER_SERVICE_NAME}'`,
      async () => {
        const services: RegisteredService[] = [];
        for await (const service of client.registry.services.list()) {
          services.push(service);
        }
        const service = services.find((s) => s.name === SCORER_SERVICE_NAME);
        if (!service) {
          fail(
            `registered service '${SCORER_SERVICE_NAME}' not found — run ./setup.sh (04-priority-scorer.sh) first`
          );
        }
        log(`scorer service=${service.id}`);
        return service.id;
      }
    );

    const workflow = await runStage(
      `resolve workflow '${WORKFLOW_NAME}'`,
      async () => {
        let found: Workflow | undefined;
        for await (const wf of client.workflows.list()) {
          if (wf.name === WORKFLOW_NAME) {
            found = wf;
            break;
          }
        }
        if (!found) {
          fail(
            `workflow '${WORKFLOW_NAME}' not found — run ./setup.sh (05-workflow.sh) first`
          );
        }
        log(`workflow=${found.id}`);
        return found;
      }
    );

    // ----- Stage 3: seed / reset the E2E contact ----------------------------
    const contactId = await runStage(
      "seed HubSpot contact (create-or-reuse by telegram_user_id)",
      async () => {
        const searchResult = (await client.connectors.invoke(
          hubspot.connectorId,
          hubspot.searchContactEndpointId,
          {
            method: "POST",
            data: {
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName: TELEGRAM_USER_ID_PROPERTY,
                      operator: "EQ",
                      value: String(testChatId),
                    },
                  ],
                },
              ],
              limit: 1,
            },
          }
        )) as HubspotSyncInvokeResult;

        const hits = asRecord(searchResult.data)?.results as
          | Array<{ id?: string }>
          | undefined;
        const existingId = hits?.[0]?.id;
        if (existingId) {
          log(`reusing existing E2E contact id=${existingId}`);
          cleanup.contactId = existingId;
          return existingId;
        }

        const createResult = (await client.connectors.invoke(
          hubspot.connectorId,
          hubspot.createContactEndpointId,
          {
            method: "POST",
            data: {
              properties: {
                telegram_user_id: String(testChatId),
                firstname: `${E2E_TAG} CRM Demo`,
                lastname: "Contact",
                email: `e2e-${testChatId}@example.invalid`,
              },
            },
          }
        )) as HubspotSyncInvokeResult;
        if (createResult.status < 200 || createResult.status >= 300) {
          fail(
            `contact create FAILED: HTTP ${createResult.status}: ${JSON.stringify(createResult.data)}`
          );
        }
        const created = asRecord(createResult.data);
        const newId = typeof created?.id === "string" ? created.id : undefined;
        if (!newId) {
          fail(
            `contact create response missing id: ${JSON.stringify(createResult.data)}`
          );
        }
        log(`created E2E contact id=${newId}`);
        cleanup.contactId = newId;
        return newId;
      }
    );

    await runStage(
      "reset associated deals (guarantee a deterministic standard-tier start)",
      async () => {
        const listResult = (await client.connectors.invoke(
          hubspot.connectorId,
          hubspot.dealsEndpointId,
          { method: "POST", data: { inputs: [{ id: contactId }] } }
        )) as HubspotSyncInvokeResult;
        const rows = asRecord(listResult.data)?.results as
          | Array<{ to?: Array<{ id?: string; toObjectId?: string }> }>
          | undefined;
        const dealIds = (rows ?? []).flatMap(
          (r) =>
            r.to
              ?.map((t) => t.id ?? t.toObjectId)
              .filter((v): v is string => !!v) ?? []
        );
        if (dealIds.length === 0) {
          log("no pre-existing associated deals — already at a clean baseline");
          return;
        }
        let removed = 0;
        for (const dealId of dealIds) {
          const propsResp = await hubspotFetch(
            hubspotServiceKey,
            `/crm/v3/objects/deals/${dealId}?properties=dealname`,
            { method: "GET" }
          );
          if (!propsResp.ok) {
            warn(
              `  could not read deal ${dealId} properties — leaving it alone`
            );
            continue;
          }
          const props = asRecord(await propsResp.json());
          const dealname = asRecord(props?.properties)?.dealname;
          if (typeof dealname === "string" && dealname.startsWith(E2E_TAG)) {
            await hubspotDelete(
              hubspotServiceKey,
              `/crm/v3/objects/deals/${dealId}`,
              `stale E2E deal ${dealId}`
            );
            removed += 1;
          }
        }
        log(
          `reset: removed ${removed}/${dealIds.length} pre-existing E2E-tagged deal(s)`
        );
      }
    );

    // ----- Stage 4: cache probe (SPEC "cache miss then hit") ---------------
    // See the header comment's deviation note #2: demonstrated directly on
    // the same cacheable endpoint the scorer uses, since the scorer's own
    // internal invoke has no execution-visible cacheResult.
    await runStage(
      "cache probe: list-deals-by-contact miss-then-hit",
      async () => {
        const first = (await client.connectors.invoke(
          hubspot.connectorId,
          hubspot.dealsEndpointId,
          { method: "POST", data: { inputs: [{ id: contactId }] } }
        )) as HubspotSyncInvokeResult;
        const second = (await client.connectors.invoke(
          hubspot.connectorId,
          hubspot.dealsEndpointId,
          { method: "POST", data: { inputs: [{ id: contactId }] } }
        )) as HubspotSyncInvokeResult;
        log(
          `first cacheResult=${first.cacheResult ?? "n/a"}  second cacheResult=${second.cacheResult ?? "n/a"}`
        );
        record(
          checks,
          "list-deals-by-contact: first invoke is not a cache hit",
          first.cacheResult !== "hit",
          `cacheResult=${first.cacheResult ?? "n/a"}`
        );
        record(
          checks,
          "list-deals-by-contact: second invoke IS a cache hit",
          second.cacheResult === "hit",
          `cacheResult=${second.cacheResult ?? "n/a"}`
        );
      }
    );

    // ----- Stage 5: baseline execution snapshot -----------------------------
    const seenExecutionIds = await runStage(
      "snapshot existing workflow executions",
      async () => {
        const ids = new Set<string>();
        for await (const execution of client.workflows.listExecutions(
          workflow.id,
          { pageSize: 20 }
        )) {
          ids.add(execution.id);
        }
        log(
          `baseline: ${ids.size} pre-existing execution(s) excluded from polling`
        );
        return ids;
      }
    );

    async function waitForNewExecution(
      afterMs: number,
      label: string
    ): Promise<WorkflowExecutionListItem> {
      const deadline = Date.now() + EXECUTION_POLL_TIMEOUT_S * 1000;
      while (Date.now() < deadline) {
        for await (const execution of client.workflows.listExecutions(
          workflow.id,
          { pageSize: 20 }
        )) {
          if (seenExecutionIds.has(execution.id)) {
            continue;
          }
          if (new Date(execution.createdAt).getTime() < afterMs - 2000) {
            continue;
          }
          if (
            execution.status === "COMPLETED" ||
            execution.status === "FAILED"
          ) {
            seenExecutionIds.add(execution.id);
            log(`${label}: execution ${execution.id} -> ${execution.status}`);
            return execution;
          }
          log(
            `${label}: execution ${execution.id} still ${execution.status} — waiting`
          );
        }
        await sleep(3);
      }
      fail(
        `${label}: no completed execution observed within ${EXECUTION_POLL_TIMEOUT_S}s`
      );
    }

    // ----- Stage 6: STANDARD-tier run ---------------------------------------
    const standardNonce = `${Date.now()}-${Math.floor(Math.random() * 32768)}`;
    const standardSentAt = await runStage(
      "send standard-tier simulated inbound",
      async () => {
        const sentAt = Date.now();
        const update = buildTelegramUpdate(
          testChatId,
          `E2E test message (standard) ${standardNonce}`
        );
        const ingestResult = await client.webhooks.ingest({
          tenant,
          channel: "telegram",
          instance: telegram.externalId,
          headers: { "x-telegram-bot-api-secret-token": appSecret },
          body: update,
        });
        record(
          checks,
          "standard-tier inbound accepted",
          ingestResult.status === "accepted",
          `status=${ingestResult.status}`
        );
        return sentAt;
      }
    );

    const standardExecution = await runStage(
      "poll for the standard-tier execution",
      () => waitForNewExecution(standardSentAt, "standard")
    );

    await runStage("assert standard-tier execution results", async () => {
      const detail = await client.workflows.getExecution(
        workflow.id,
        standardExecution.id
      );
      const ctx = detail.result as RunResultContext | undefined;
      const results = ctx?.results ?? {};

      record(
        checks,
        "standard: execution COMPLETED",
        detail.status === "COMPLETED",
        `status=${detail.status}`
      );

      const searchContact = asRecord(results.searchContact);
      record(
        checks,
        "standard: searchContact executed (HTTP 200)",
        asRecord(searchContact)?.status === 200,
        `status=${String(asRecord(searchContact)?.status)}`
      );

      const normalizeContact = asRecord(results.normalizeContact);
      record(
        checks,
        "standard: contact resolved to the seeded E2E contact",
        normalizeContact?.contactKnown === true &&
          normalizeContact?.contactId === contactId,
        `contactKnown=${String(normalizeContact?.contactKnown)} contactId=${String(normalizeContact?.contactId)}`
      );

      const scoreContact = asRecord(results.scoreContact);
      const scoreData = asRecord(scoreContact?.data);
      record(
        checks,
        "standard: score computed with tier=standard (0 seeded deals)",
        scoreData?.tier === "standard",
        `tier=${String(scoreData?.tier)} reasons=${JSON.stringify(scoreData?.reasons)}`
      );

      const supportAgent = asRecord(results.supportAgent);
      const agentData = asRecord(supportAgent?.data);
      record(
        checks,
        "standard: agent produced a non-empty reply",
        typeof agentData?.reply === "string" && agentData.reply.length > 0,
        `reply=${JSON.stringify(agentData?.reply)}`
      );

      // Deviation note #3 (header comment): channelSend is fire-and-forget —
      // `published: true` is the strongest signal getExecution() exposes.
      const replyStandard = asRecord(results.replyStandard);
      record(
        checks,
        "standard: reply publish confirmed (channelSend)",
        replyStandard?.published === true,
        `published=${String(replyStandard?.published)}`
      );
    });

    // ----- Stage 7: wait out the read-cache TTL before seeding VIP deals ---
    await runStage(
      `wait ${HUBSPOT_CACHE_TTL_SECONDS + 5}s for the connector's ${HUBSPOT_CACHE_TTL_SECONDS}s read-cache TTL to expire`,
      async () => {
        log(
          "otherwise the scorer's next list-deals-by-contact call could hit a" +
            " STALE (pre-seed, deal-less) cache entry for this exact contact and" +
            " never see the newly seeded VIP deals — see readCacheStrategy," +
            " 02-hubspot-connector.ts"
        );
        await sleep(HUBSPOT_CACHE_TTL_SECONDS + 5);
      }
    );

    // ----- Stage 8: seed VIP deals -------------------------------------------
    await runStage(
      `seed ${VIP_DEAL_COUNT} VIP deals + associate to contact`,
      async () => {
        for (let i = 1; i <= VIP_DEAL_COUNT; i++) {
          const createResp = await hubspotFetch(
            hubspotServiceKey,
            "/crm/v3/objects/deals",
            {
              method: "POST",
              body: {
                properties: {
                  dealname: `${E2E_TAG} Priority scorer VIP seed deal ${i}`,
                  // hs_pipeline/dealstage intentionally omitted — HubSpot
                  // defaults to the account's default pipeline/stage, same
                  // "resolve by API, never hardcode" boundary 05-workflow.ts's
                  // ticket body already follows (T06 finding).
                },
              },
            }
          );
          if (!createResp.ok) {
            fail(
              `VIP deal ${i} create FAILED: HTTP ${createResp.status}: ${await createResp.text()}`
            );
          }
          const created = asRecord(await createResp.json());
          const dealId =
            typeof created?.id === "string" ? created.id : undefined;
          if (!dealId) {
            fail(`VIP deal ${i} create response missing id`);
          }
          cleanup.dealIds.push(dealId);

          const assocResp = await hubspotFetch(
            hubspotServiceKey,
            `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`,
            { method: "PUT" }
          );
          if (!assocResp.ok) {
            fail(
              `VIP deal ${i} (${dealId}) association FAILED: HTTP ${assocResp.status}: ${await assocResp.text()}`
            );
          }
          log(`seeded + associated VIP deal ${i}/${VIP_DEAL_COUNT}: ${dealId}`);
        }
      }
    );

    // ----- Stage 9: VIP-tier run ---------------------------------------------
    const vipNonce = `${Date.now()}-${Math.floor(Math.random() * 32768)}`;
    const vipSentAt = await runStage(
      "send VIP-tier simulated inbound",
      async () => {
        const sentAt = Date.now();
        const update = buildTelegramUpdate(
          testChatId,
          `E2E test message (vip) ${vipNonce}`
        );
        const ingestResult = await client.webhooks.ingest({
          tenant,
          channel: "telegram",
          instance: telegram.externalId,
          headers: { "x-telegram-bot-api-secret-token": appSecret },
          body: update,
        });
        record(
          checks,
          "VIP-tier inbound accepted",
          ingestResult.status === "accepted",
          `status=${ingestResult.status}`
        );
        return sentAt;
      }
    );

    const vipExecution = await runStage("poll for the VIP-tier execution", () =>
      waitForNewExecution(vipSentAt, "vip")
    );

    let createTicketInvocationId: string | undefined;
    await runStage("assert VIP-tier execution results", async () => {
      const detail = await client.workflows.getExecution(
        workflow.id,
        vipExecution.id
      );
      const ctx = detail.result as RunResultContext | undefined;
      const results = ctx?.results ?? {};

      record(
        checks,
        "vip: execution COMPLETED",
        detail.status === "COMPLETED",
        `status=${detail.status}`
      );

      const scoreContact = asRecord(results.scoreContact);
      const scoreData = asRecord(scoreContact?.data);
      const reasons = Array.isArray(scoreData?.reasons)
        ? (scoreData?.reasons as unknown[])
        : [];
      record(
        checks,
        "vip: score computed with tier=vip (>= VIP_DEAL_COUNT seeded deals)",
        scoreData?.tier === "vip",
        `tier=${String(scoreData?.tier)} reasons=${JSON.stringify(reasons)}`
      );
      record(
        checks,
        "vip: reasons cite the open-deals VIP threshold",
        reasons.some(
          (r) =>
            typeof r === "string" &&
            r.startsWith("open-deals-vip-threshold-met:")
        ),
        `reasons=${JSON.stringify(reasons)}`
      );

      const buildAgentContext = asRecord(results.buildAgentContext);
      record(
        checks,
        "vip: conditional gate saw tier=vip",
        buildAgentContext?.tier === "vip",
        `tier=${String(buildAgentContext?.tier)}`
      );

      const createTicket = asRecord(results.createTicket);
      const createTicketData = asRecord(createTicket?.data);
      const invocationId =
        typeof createTicketData?.invocationId === "string"
          ? createTicketData.invocationId
          : undefined;
      record(
        checks,
        "vip: VIP branch fired createTicket (async invoke accepted)",
        typeof invocationId === "string" && invocationId.length > 0,
        `invocationId=${String(invocationId)}`
      );
      createTicketInvocationId = invocationId;

      const replyEscalated = asRecord(results.replyEscalated);
      record(
        checks,
        "vip: escalation reply publish confirmed (channelSend)",
        replyEscalated?.published === true,
        `published=${String(replyEscalated?.published)}`
      );
    });

    // ----- Stage 10: poll the async ticket invocation to completion --------
    if (createTicketInvocationId) {
      await runStage(
        "poll connectors.invocations.get() for the ticket invocation",
        async () => {
          const invocationId = createTicketInvocationId as string;
          const deadline = Date.now() + INVOCATION_POLL_TIMEOUT_S * 1000;
          let final: HubspotInvocationCompleted | undefined;
          while (Date.now() < deadline) {
            const status = (await client.connectors.invocations.get(
              invocationId
            )) as HubspotInvocationStatus;
            if (status.status === "completed") {
              final = status;
              break;
            }
            log(`invocation ${invocationId} still pending — waiting`);
            await sleep(3);
          }
          if (!final) {
            record(
              checks,
              "vip: ticket invocation completed within timeout",
              false,
              `no completion observed within ${INVOCATION_POLL_TIMEOUT_S}s`
            );
            return;
          }
          record(
            checks,
            "vip: ticket invocation completed with outcome=ok",
            final.outcome === "ok",
            `outcome=${final.outcome}${final.error ? ` error=${JSON.stringify(final.error)}` : ""}`
          );
          const ticketData = asRecord(final.result?.data);
          const ticketId =
            typeof ticketData?.id === "string" ? ticketData.id : undefined;
          if (ticketId) {
            log(
              `created HubSpot ticket id=${ticketId} (registered for cleanup)`
            );
            cleanup.ticketId = ticketId;
          } else {
            warn(
              `ticket invocation completed but no HubSpot object id found in result: ${JSON.stringify(final.result)}`
            );
          }
        }
      );
    } else {
      record(
        checks,
        "vip: ticket invocation completed with outcome=ok",
        false,
        "no invocationId to poll (createTicket did not fire)"
      );
    }

    // ----- Stage 11: the money shot -----------------------------------------
    // admin-console route `processes/runs/:workflowId/:runId`
    // (services/admin-console/src/app/app.routes.ts) binds
    // `temporalWorkflowId`/`temporalRunId` — the exact fields
    // WorkflowExecutionListItem returns (services/admin-console/src/app/
    // features/automation/workflows/detail/workflow-executions.component.ts,
    // the routerLink build). Host convention mirrors GW_HOST
    // (integrations/lib/resolve-env.sh) against the `admin-console` Knative
    // service (knative/services/base/admin-console.yaml) — same namespace
    // pattern as api-gateway; not verified against a dedicated Ingress
    // manifest (none found in this repo — Knative's default domain
    // templating is assumed, same assumption 04-priority-scorer.ts's
    // in-cluster addressing note documents for `*.svc.cluster.local`).
    await runStage(
      "print admin-console run-view URLs (the money shot)",
      async () => {
        const ywaiEnv = process.env.PLATFORM_ENVIRONMENT ?? "dev";
        const devDomain = process.env.DEV_DOMAIN ?? "dev.local";
        const adminBase =
          process.env.ADMIN_CONSOLE_BASE_URL ??
          `http://admin-console.platform-services-${ywaiEnv}.${devDomain}`;
        const standardUrl = `${adminBase}/processes/runs/${standardExecution.temporalWorkflowId}/${standardExecution.temporalRunId}`;
        const vipUrl = `${adminBase}/processes/runs/${vipExecution.temporalWorkflowId}/${vipExecution.temporalRunId}`;
        console.log();
        step("admin-console run-view URLs");
        log(`standard-tier run: ${standardUrl}`);
        log(`VIP-tier run:      ${vipUrl}`);
      }
    );

    // ----- Stage 12: PASS/FAIL summary --------------------------------------
    console.log();
    step("PASS/FAIL summary");
    const failed = checks.filter((c) => !c.pass);
    for (const c of checks) {
      log(`[${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
    }
    console.log();
    if (failed.length > 0) {
      err(`${failed.length}/${checks.length} assertion(s) FAILED`);
    } else {
      log(`all ${checks.length} assertions PASSED`);
    }

    await runCleanup(hubspotServiceKey);

    if (failed.length > 0) {
      process.exit(1);
    }
  } catch (e) {
    err(`06-run-e2e failed: ${messageOf(e)}`);
    if (hubspotServiceKeyForSignals) {
      await runCleanup(hubspotServiceKeyForSignals);
    }
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    fail(`06-run-e2e failed: ${e instanceof Error ? e.message : e}`);
  });
}

export { main };
