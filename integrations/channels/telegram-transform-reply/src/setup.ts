/**
 * telegram-transform-reply sample provisioning — SDK-powered replacement for
 * the old curl+jq `setup.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * Provisions a Telegram channel account (RECEIVE + SEND, wiring the
 * platform's built-in TelegramProvider) + a workflow (transform jsFunction +
 * reply channelSend to the SAME chat the inbound message came from), through
 * `@yoizen/platform-sdk`'s `channels` and `workflows` resources. Also
 * registers the Telegram webhook (raw Telegram Bot API `setWebhook` — not
 * part of our platform SDK, so it stays a plain `fetch()` call) and, on
 * request, drives the chain with a synthetic inbound update.
 *
 * Same env vars, defaults, idempotency/dedup/RECREATE semantics, webhook
 * registration behavior, and final summary output as the bash version this
 * replaces. Invoked by `setup.sh` after `../lib/resolve-env.sh` has resolved
 * the environment, and re-exported for `index.ts` (the `run.sh` driver, which
 * additionally requires a real `TELEGRAM_BOT_TOKEN` before delegating here —
 * see index.ts).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh). Only
// script-specific vars are read here. (resolve-env.sh also exports TG_*
// aliases for these same values, but — matching the bash script this
// replaces — this file reads the YOIZEN_* names directly.)

// Telegram bot token (from @BotFather). REQUIRED for real delivery — it is
// the credential the SEND path uses. With a placeholder, artifacts still
// provision but every send returns 404.
let TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

// Public HTTPS base reachable by Telegram (e.g. your cloudflared tunnel:
// https://api.devmachina.net). When set + a real token, stage 4 registers
// the webhook for you at <TG_PUBLIC_URL>/api/webhooks/telegram/<tenant>.
const TG_PUBLIC_URL = process.env.TG_PUBLIC_URL ?? "";

// Stable identity PREFIX. Reuse matches any active telegram account whose
// externalId starts with this; each create appends a unique suffix.
const EXTERNAL_PREFIX = process.env.TG_EXTERNAL_ID ?? "telegram-sample-bot";
const ACCOUNT_NAME = process.env.TG_ACCOUNT_NAME ?? "Telegram Sample Bot";
const WORKFLOW_NAME =
  process.env.TG_WORKFLOW_NAME ?? "telegram-transform-reply";
const APPLICATION = process.env.TG_APPLICATION ?? "samples";

const TG_PIN = process.env.TG_PIN ?? "1";

const RECREATE = process.env.RECREATE ?? "0";

// Optional end-to-end drive of the chain with a synthetic inbound update.
const SIMULATE_INBOUND = process.env.SIMULATE_INBOUND ?? "0";
const TELEGRAM_TEST_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID ?? "";
const POLL_TIMEOUT_S = Number(process.env.TG_POLL_TIMEOUT_S ?? "60");

// Local cache of the webhook secret (appSecret is only returned at
// creation), so re-runs can still register/simulate after REUSING an
// existing account.
const sampleDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET_FILE =
  process.env.TG_SECRET_FILE ?? path.join(sampleDir, ".telegram-sample-secret");

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

// The transform step. Echoes ctx.request.text plus an ISO-8601 timestamp
// (toISOString() carries .mmm milliseconds) and the epoch ms. Returns
// { text } -> read as {{results.transform.text}}.
const TRANSFORM_CODE = `(context) => {
  var src = (context.request && context.request.text) || "";
  var now = new Date();
  return { text: "Echo: " + src + " — processed at " + now.toISOString() + " (epoch_ms=" + now.getTime() + ")" };
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

let ACCOUNT_ID = "";
let EXTERNAL_ID = "";
let APP_SECRET = "";
let WORKFLOW_ID = "";

export interface SetupResult {
  accountId: string;
  externalId: string;
  appSecret: string;
  workflowId: string;
}

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/5 preflight");
  if (!TELEGRAM_BOT_TOKEN) {
    TELEGRAM_BOT_TOKEN = "PLACEHOLDER:set-TELEGRAM_BOT_TOKEN-for-real-delivery";
    warn("TELEGRAM_BOT_TOKEN not set — using a placeholder.");
    warn(
      "Artifacts will provision, but the SEND path will 404 until you use a real token."
    );
  }
  if (SIMULATE_INBOUND === "1" && !TELEGRAM_TEST_CHAT_ID) {
    fail(
      "SIMULATE_INBOUND=1 requires TELEGRAM_TEST_CHAT_ID with your real numeric chat id.\n" +
        "       Using a fake chat id makes Telegram reject the reply with: Bad Request: chat not found."
    );
  }
  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}`
  );
}

// ----- Stage 2: ensure the Telegram channel account (receive + send) --------
async function ensureAccount(): Promise<void> {
  step(`2/5 ensure Telegram channel account (prefix=${EXTERNAL_PREFIX})`);

  const accounts: ChannelAccount[] = [];
  for await (const account of client.channels.listAccounts({
    channel: "telegram",
  })) {
    accounts.push(account);
  }

  // Collect ALL prefix-matching active accounts, newest first (the API
  // returns them oldest-first, so reverse).
  const matching = accounts
    .filter((a) => a.externalId.startsWith(EXTERNAL_PREFIX) && a.isActive)
    .reverse();

  const keep = matching[0];
  const stale = matching.slice(1);

  // Always keep at most one: the most recently created. Delete the rest
  // whether this is a normal run or a recreate — prevents stale account
  // accumulation.
  for (const account of stale) {
    log(`removing stale prefix-matching account ${account.id}`);
    await client.channels.removeAccount(account.id).catch(() => undefined);
  }

  // Reuse the surviving account unless RECREATE=1.
  if (keep && RECREATE !== "1") {
    ACCOUNT_ID = keep.id;
    EXTERNAL_ID = keep.externalId;
    APP_SECRET = loadSecret();
    log(
      `reusing existing account ${ACCOUNT_ID} externalId=${EXTERNAL_ID} (set RECREATE=1 to rotate token/secret)`
    );
    if (APP_SECRET) {
      log("loaded cached webhook secret");
    } else {
      warn(
        "no cached webhook secret — run once with RECREATE=1 to mint+cache one"
      );
    }
    return;
  }

  // Recreate path: remove the surviving account too. A delete may not free
  // the global (channel, external_id) unique key in dev, so the create
  // below uses a UNIQUE externalId and never collides.
  if (keep) {
    log(`removing prefix-matching account ${keep.id}`);
    await client.channels.removeAccount(keep.id).catch(() => undefined);
  }

  EXTERNAL_ID = `${EXTERNAL_PREFIX}-${Math.floor(Date.now() / 1000)}-${Math.floor(
    Math.random() * 32768
  )}`;

  const created = await client.channels
    .createAccount({
      channel: "telegram",
      provider: "telegram",
      name: ACCOUNT_NAME,
      externalId: EXTERNAL_ID,
      telegramBotToken: TELEGRAM_BOT_TOKEN,
      accessToken: TELEGRAM_BOT_TOKEN,
      isActive: true,
    })
    .catch((e) => {
      fail(`Account creation failed: ${e instanceof Error ? e.message : e}`);
    });

  if (!created?.id) {
    fail(`Account creation failed: ${JSON.stringify(created)}`);
  }
  ACCOUNT_ID = created.id;
  APP_SECRET = created.appSecret ?? "";
  saveSecret(APP_SECRET);
  log(`created account id=${ACCOUNT_ID} externalId=${EXTERNAL_ID}`);
  if (APP_SECRET) {
    log("webhook secret captured + cached");
  } else {
    warn(
      "create response did not expose appSecret — webhook register/simulate will be skipped"
    );
  }
}

// buildWorkflowBody — accountId is account-agnostic:
// {{request.envelope.accountId}} is the inbound message's own account, so
// the workflow never needs editing when the account is recreated. `to`
// reads {{request.from}} — the inbound sender's chat id — so the reply
// always lands in the SAME chat the message came from.
function buildWorkflowBody() {
  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "transform",
        activity: "jsFunction",
        args: { code: TRANSFORM_CODE },
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
          text: "{{results.transform.text}}",
        },
      },
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["telegram"],
        providers: ["telegram"],
        ...(TG_PIN === "1" ? { accountIds: [ACCOUNT_ID] } : {}),
      },
    },
  };
}

// ----- Stage 3: ensure the transform-and-reply workflow ----------------------
async function ensureWorkflow(): Promise<void> {
  step(`3/5 ensure workflow '${WORKFLOW_NAME}'`);

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

  // Delete all duplicates on every run, not just on recreate.
  for (const workflow of stale) {
    log(`removing duplicate workflow ${workflow.id}`);
    await client.workflows.remove(workflow.id).catch(() => undefined);
  }

  if (keep && RECREATE !== "1") {
    WORKFLOW_ID = keep.id;
    log(`reusing existing workflow ${WORKFLOW_ID}`);
    return;
  }
  if (keep) {
    log(`RECREATE=1 — replacing workflow ${keep.id}`);
    await client.workflows.remove(keep.id).catch(() => undefined);
  }

  const body = buildWorkflowBody();
  const created = await client.workflows.create(body).catch((e) => {
    fail(`Workflow creation failed: ${e instanceof Error ? e.message : e}`);
  });
  if (!created?.id) {
    fail(`Workflow creation failed: ${JSON.stringify(created)}`);
  }
  WORKFLOW_ID = created.id;
  log(`created workflow id=${WORKFLOW_ID}`);
}

// ----- Stage 4: register the Telegram webhook (needs a public HTTPS URL) -----
async function registerWebhook(): Promise<void> {
  step("4/5 register Telegram webhook");
  // NOTE the /api prefix — the gateway has a global prefix `api`, so the real
  // webhook path is /api/webhooks/telegram/<tenant>/<externalId>. The
  // platform's own auto-registration omits `/api`; this stage uses the
  // correct path and wins.
  const webhookPath = `/api/webhooks/telegram/${tenant}/${EXTERNAL_ID}`;

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
  if (!APP_SECRET) {
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
        secret_token: APP_SECRET,
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

// ----- Stage 5 (optional): drive the chain with a synthetic inbound update ---
async function simulateInbound(): Promise<void> {
  step("5/5 simulate inbound Telegram update");
  if (SIMULATE_INBOUND !== "1") {
    log("SIMULATE_INBOUND!=1 — skipping. To drive the chain end-to-end:");
    log(
      "    SIMULATE_INBOUND=1 TELEGRAM_TEST_CHAT_ID=<your-chat-id> ./setup.sh"
    );
    return;
  }
  if (!APP_SECRET) {
    warn(
      "no appSecret available — cannot sign the webhook; skipping simulation"
    );
    return;
  }

  const nonce = `tg-${Math.floor(Date.now() / 1000)}-${Math.floor(
    Math.random() * 32768
  )}`;
  const messageText = `hello ${nonce}`;
  const chatId = Number(TELEGRAM_TEST_CHAT_ID);

  const update = {
    update_id: 1,
    message: {
      message_id: Math.floor(Math.random() * 32768),
      date: Math.floor(Date.now() / 1000),
      from: { id: chatId, is_bot: false, first_name: "Sample" },
      chat: { id: chatId, type: "private" },
      text: messageText,
    },
  };

  log(
    `POST /api/webhooks/telegram/${tenant}/${EXTERNAL_ID}  (chat_id=${TELEGRAM_TEST_CHAT_ID}, text='${messageText}')`
  );
  const ingestResult = await client.webhooks.ingest({
    tenant,
    channel: "telegram",
    instance: EXTERNAL_ID,
    headers: { "x-telegram-bot-api-secret-token": APP_SECRET },
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
    for await (const execution of client.workflows.listExecutions(WORKFLOW_ID, {
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
  await ensureAccount();
  await ensureWorkflow();
  await registerWebhook();
  await simulateInbound();

  console.log();
  log("Done. Artifacts:");
  log(`  - Telegram account ${ACCOUNT_ID} (prefix ${EXTERNAL_PREFIX})`);
  log(
    `  - Workflow ${WORKFLOW_ID} (${WORKFLOW_NAME}): transform + reply over Telegram`
  );
  console.log();
  if (TELEGRAM_BOT_TOKEN.startsWith("PLACEHOLDER:")) {
    warn(
      "You used a placeholder token — sends will 404. Re-run with a real TELEGRAM_BOT_TOKEN and RECREATE=1."
    );
  }
  log(
    "If earlier sends failed (404/circuit_open), reset the egress breaker once:"
  );
  log(
    "    kubectl rollout restart deploy/channel-service-worker -n <namespace>"
  );
  log(
    "Then message the bot — reply: 'Echo: <your text> — processed at <ISO ms> (epoch_ms=...)'."
  );

  return {
    accountId: ACCOUNT_ID,
    externalId: EXTERNAL_ID,
    appSecret: APP_SECRET,
    workflowId: WORKFLOW_ID,
  };
}

// Only auto-run when invoked directly (`tsx src/setup.ts`), not when
// imported by index.ts (the run.sh driver, which re-exports this same
// provisioning logic after enforcing a stricter TELEGRAM_BOT_TOKEN check).
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    err(`failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
