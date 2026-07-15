/**
 * http-fanout-telegram sample provisioning — SDK-powered replacement for the
 * old curl+jq `setup.sh` body.
 *
 * Provisions a dedicated HTTP channel account + a workflow that fans THREE
 * connector calls out in parallel (branch, like Promise.all), joins the
 * results, POSTs the joined payload to the httpbin connector, and sends a
 * summary via Telegram — through `@yoizen/platform-sdk`'s `connectors`,
 * `channels`, and `workflows` resources.
 *
 * Same env vars, defaults, idempotency/dedup/RECREATE semantics, and final
 * summary output as the bash version this replaces. Invoked by `setup.sh`
 * after `../lib/resolve-env.sh` has resolved the environment.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
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
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh).
// Only script-specific vars are read here.

const WORKFLOW_NAME =
  process.env.FANOUT_WORKFLOW_NAME ?? "http-fanout-telegram";
const APPLICATION = process.env.FANOUT_APPLICATION ?? "samples";

// Connector names to resolve to adapterIds (must already exist; context=external).
const JP_NAME = process.env.FANOUT_JSONPLACEHOLDER ?? "jsonplaceholder";
const POKE_NAME = process.env.FANOUT_POKEAPI ?? "pokeapi";
const CAT_NAME = process.env.FANOUT_CATFACTS ?? "catfacts";
const HTTPBIN_NAME = process.env.FANOUT_HTTPBIN ?? "httpbin";

// Telegram recipient. REQUIRED. Your numeric chat_id (DM the bot, then read it
// from getUpdates, or use @userinfobot). TG_ACCOUNT_ID can pin a specific
// Telegram channel account; otherwise the first active one is used.
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
let TG_ACCOUNT_ID = process.env.TG_ACCOUNT_ID ?? "";

// Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
// path segment of the per-instance ingress URL
// (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
// pinned to this account's id (accountIds) so ONLY messages to this instance
// fire it — no cross-firing with other http workflows.
const HTTP_EXTERNAL_ID =
  process.env.FANOUT_HTTP_EXTERNAL_ID ?? "http-fanout-telegram";
const HTTP_ACCOUNT_NAME =
  process.env.FANOUT_HTTP_ACCOUNT_NAME ?? "HTTP Fanout Telegram";

// Pin the trigger to the dedicated http instance via accountIds (Opción B).
// ON by default: the pin matches only messages resolved to this specific http
// account, preventing cross-firing with other http workflows. Set FANOUT_PIN=0
// to disable and let ANY http message trigger the workflow.
const FANOUT_PIN = process.env.FANOUT_PIN ?? "1";

const RECREATE = process.env.RECREATE ?? "0";

// The join step. English code/comments; user-facing summary text in Spanish
// (matches the bash version verbatim). Reads each parallel call's body from
// ctx.results.<name>.data and returns:
//   - summary:      a human string for the Telegram message
//   - combinedJson: a JSON string for the httpbin POST body
// (values flow on via {{results.join.*}}, which is String()-coerced
//  downstream, so we hand off strings, not nested objects).
const JOIN_CODE = `(ctx) => {
  var post = (ctx.results.getPost && ctx.results.getPost.data) || {};
  var poke = (ctx.results.getPokemon && ctx.results.getPokemon.data) || {};
  var cat  = (ctx.results.getCatFact && ctx.results.getCatFact.data) || {};
  var inbound = (ctx.request && ctx.request.text) || "";
  var combined = {
    inbound: inbound,
    post: { id: post.id, title: post.title },
    pokemon: { name: poke.name, baseExperience: poke.base_experience },
    catFact: cat.fact
  };
  var summary =
    "Mensaje recibido: " + inbound + "\\n" +
    "Post: " + (post.title || "-") + "\\n" +
    "Pokemon: " + (poke.name || "-") + "\\n" +
    "Dato gatuno: " + (cat.fact || "-");
  return { summary: summary, combinedJson: JSON.stringify(combined) };
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

let jpId = "";
let pokeId = "";
let catId = "";
let httpbinId = "";
let httpAccountId = "";
let httpAppSecret = "";
let workflowId = "";

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/3 preflight");
  if (!TELEGRAM_CHAT_ID) {
    err("TELEGRAM_CHAT_ID is required — your numeric Telegram chat id.");
    err(
      `DM your bot first, then: curl -s "https://api.telegram.org/bot<token>/getUpdates" | jq '.result[].message.chat.id'`
    );
    process.exit(1);
  }
  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}`
  );
  log(`telegram chat_id=${TELEGRAM_CHAT_ID}`);
}

// resolveAdapterId <name> — the connector's id, or "" if not found.
async function resolveAdapterId(name: string): Promise<string> {
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    if (connector.name === name) {
      return connector.id;
    }
  }
  return "";
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

// ----- Stage 2: resolve dependency ids (connectors + telegram + http instance) -
async function stageResolve(): Promise<void> {
  step("2/3 resolve connectors + telegram account + http instance");

  jpId = await resolveAdapterId(JP_NAME);
  pokeId = await resolveAdapterId(POKE_NAME);
  catId = await resolveAdapterId(CAT_NAME);
  httpbinId = await resolveAdapterId(HTTPBIN_NAME);

  const missing: string[] = [];
  if (!jpId) {
    missing.push(JP_NAME);
  }
  if (!pokeId) {
    missing.push(POKE_NAME);
  }
  if (!catId) {
    missing.push(CAT_NAME);
  }
  if (!httpbinId) {
    missing.push(HTTPBIN_NAME);
  }
  if (missing.length > 0) {
    err(`connector(s) not found: ${missing.join(" ")}`);
    err("Provision them first:  (cd ../http-connectors && ./setup.sh)");
    process.exit(1);
  }
  log(
    `connectors  jsonplaceholder=${jpId}  pokeapi=${pokeId}  catfacts=${catId}  httpbin=${httpbinId}`
  );

  if (!TG_ACCOUNT_ID) {
    const tgAccounts: ChannelAccount[] = [];
    for await (const account of client.channels.listAccounts({
      channel: "telegram",
    })) {
      tgAccounts.push(account);
    }
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

  await ensureHttpAccount();
}

// buildWorkflowBody — assemble the workflow definition with resolved ids.
function buildWorkflowBody() {
  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "fanout",
        activity: "branch",
        jsonplaceholder: [
          {
            name: "getPost",
            activity: "endpointCall",
            args: { adapterId: jpId, method: "GET", url: "/posts/1" },
          },
        ],
        pokeapi: [
          {
            name: "getPokemon",
            activity: "endpointCall",
            args: {
              adapterId: pokeId,
              method: "GET",
              url: "/api/v2/pokemon/ditto",
            },
          },
        ],
        catfacts: [
          {
            name: "getCatFact",
            activity: "endpointCall",
            args: { adapterId: catId, method: "GET", url: "/fact" },
          },
        ],
      },
      {
        name: "join",
        activity: "jsFunction",
        args: { code: JOIN_CODE },
      },
      {
        name: "postToHttpbin",
        activity: "endpointCall",
        args: {
          adapterId: httpbinId,
          method: "POST",
          url: "/post",
          data: {
            source: "http-fanout-telegram",
            summary: "{{results.join.summary}}",
            payload: "{{results.join.combinedJson}}",
          },
        },
      },
      {
        name: "notify",
        activity: "channelSend",
        args: {
          accountId: TG_ACCOUNT_ID,
          channel: "telegram",
          provider: "telegram",
          to: TELEGRAM_CHAT_ID,
          type: "text",
          text: "{{results.join.summary}}\n(httpbin status: {{results.postToHttpbin.status}})",
        },
      },
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["http"],
        providers: ["http"],
        ...(FANOUT_PIN === "1" ? { accountIds: [httpAccountId] } : {}),
      },
    },
  };
}

// ----- Stage 3: ensure the workflow ------------------------------------------
async function stageEnsureWorkflow(): Promise<void> {
  step(`3/3 ensure workflow '${WORKFLOW_NAME}'`);

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
  await stageResolve();
  await stageEnsureWorkflow();

  const ingestUrl = `${baseUrl}/api/webhooks/http/${tenant}/${HTTP_EXTERNAL_ID}`;

  console.log();
  log(`Done. Workflow '${WORKFLOW_NAME}' (${workflowId}):`);
  log(
    `  trigger : message_received on channels=[http], pinned to accountIds=[${httpAccountId}]`
  );
  log(
    "  fanout  : parallel endpointCall -> jsonplaceholder + pokeapi + catfacts"
  );
  log("  join    : jsFunction merges the three responses");
  log("  post    : endpointCall POST -> httpbin /post");
  log(`  notify  : channelSend telegram -> chat ${TELEGRAM_CHAT_ID}`);
  log(
    `  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)`
  );
  console.log();
  log(
    "Drive it — POST to THIS instance's own URL (no other http workflow fires):"
  );
  log(`    curl -X POST '${ingestUrl}' \\`);
  log("      -H 'content-type: application/json' \\");
  if (httpAppSecret) {
    log(`      -H 'x-http-channel-token: ${httpAppSecret}' \\`);
  } else {
    log(
      "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
    );
  }
  log(`      -d '{"text":"hola"}'`);
  log("Then check Telegram — the bot DMs you the joined summary.");
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
