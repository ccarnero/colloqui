/**
 * http-bridge sample provisioning — SDK-powered replacement for the old
 * curl+jq `setup.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * Provisions a dedicated HTTP channel account + a workflow with an echo
 * jsFunction and a parallel Telegram notify branch, through
 * `@yoizen/platform-sdk`'s `channels` and `workflows` resources. Telegram
 * chat_id discovery talks directly to `api.telegram.org` (getWebhookInfo /
 * deleteWebhook / getUpdates / setWebhook) — that's raw Telegram Bot API, not
 * part of our platform SDK, so it stays as plain `fetch()` calls.
 *
 * Same env vars, defaults, idempotency/dedup/RECREATE semantics, and final
 * summary output as the bash version this replaces. Invoked by `setup.sh`
 * after its inlined dev-environment resolver has run.
 */
import * as readline from "node:readline";
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
// YOIZEN_PASSWORD are all exported by ../setup.sh's own inlined
// dev-environment resolver — this tier (sdk/examples) must not depend on
// integrations/lib, so setup.sh inlines that resolver verbatim instead of
// sourcing integrations/lib/resolve-env.sh; there is no resolve-env.sh here.
// Only script-specific vars are read here.

const WORKFLOW_NAME = process.env.BRIDGE_WORKFLOW_NAME ?? "http-bridge";
const APPLICATION = process.env.BRIDGE_APPLICATION ?? "samples";

// Telegram recipients — both are auto-discovered if left unset (see
// discoverChatIds: it fetches the bot's own token from the platform, then
// calls Telegram's getUpdates to find who has /start-ed it). Set either one
// explicitly to skip discovery for it and pin an exact chat_id. The workflow
// always builds a two-arm notify branch; if TELEGRAM_CHAT_ID_2 is still empty
// after discovery, that arm gets the same chat_id as the first (see
// stageResolve). TG_ACCOUNT_ID can pin a specific Telegram channel account;
// otherwise the first active one is used.
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
let TELEGRAM_CHAT_ID_2 = process.env.TELEGRAM_CHAT_ID_2 ?? "";
let TG_ACCOUNT_ID = process.env.TG_ACCOUNT_ID ?? "";

// Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
// path segment of the per-instance ingress URL
// (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
// pinned to this account's id (accountIds) so ONLY messages to this instance
// fire it — no cross-firing with other http workflows.
const HTTP_EXTERNAL_ID = process.env.BRIDGE_HTTP_EXTERNAL_ID ?? "http-bridge";
const HTTP_ACCOUNT_NAME = process.env.BRIDGE_HTTP_ACCOUNT_NAME ?? "HTTP Bridge";

// Pin the trigger to the dedicated http instance via accountIds (Opción B).
// ON by default: the pin matches only messages resolved to this specific http
// account, preventing cross-firing with other http workflows. Set BRIDGE_PIN=0
// to disable and let ANY http message trigger the workflow.
const BRIDGE_PIN = process.env.BRIDGE_PIN ?? "1";

// Defaults to always rebuild: this sample is meant to be re-run while you
// iterate on chat_ids (e.g. edit the second recipient later via the UI), so
// reuse-by-name would just mask that. Set RECREATE=0 to go back to reusing.
const RECREATE = process.env.RECREATE ?? "1";

const BRIDGE_DISCOVER_WAIT_SECONDS = Number(
  process.env.BRIDGE_DISCOVER_WAIT_SECONDS ?? "60"
);
const BRIDGE_DISCOVER_POLL_INTERVAL = Number(
  process.env.BRIDGE_DISCOVER_POLL_INTERVAL ?? "2"
);
const BRIDGE_RESTORE_WEBHOOK = process.env.BRIDGE_RESTORE_WEBHOOK ?? "1";

// The echo step. Honors the inbound payload (ctx.request.text /
// ctx.request.from / ctx.request.metadata) and adds echo data: an ISO-8601
// timestamp (toISOString() carries .mmm milliseconds) plus the epoch ms.
// Returns { text } -> read as {{results.echo.text}}.
const ECHO_CODE = `(ctx) => {
  var req = (ctx.request) || {};
  var text = req.text || "";
  var from = req.from || "unknown";
  var metadata = req.metadata ? JSON.stringify(req.metadata) : "{}";
  var now = new Date();
  var out =
    "Echo: " + text +
    " (from=" + from + ", metadata=" + metadata + ")" +
    " — processed at " + now.toISOString() +
    " (epoch_ms=" + now.getTime() + ")";
  return { text: out };
}`;

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see setup.sh's inlined
// dev-environment resolver); the SDK's fetch-based transport needs it passed
// as a regular header since we're talking to a bare IP/localhost port.
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

let httpAccountId = "";
let httpAppSecret = "";
let workflowId = "";

// ----- Stage 0: preflight ----------------------------------------------------
function stagePreflight(): void {
  step("0/3 preflight");
  log(
    `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}`
  );
  if (TELEGRAM_CHAT_ID) {
    log(
      `telegram chat_id(s) preset: ${TELEGRAM_CHAT_ID}${
        TELEGRAM_CHAT_ID_2 ? `, ${TELEGRAM_CHAT_ID_2}` : ""
      }`
    );
  } else {
    log(
      "TELEGRAM_CHAT_ID not set — will auto-discover from the bot's recent /start messages"
    );
  }
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

// ----- Telegram chat_id discovery (raw Telegram Bot API, not SDK-covered) ---

interface TelegramChat {
  id: string;
  label: string;
  date: number;
}

// fetchTelegramChats <botToken> — one getUpdates call, returns one row per
// distinct chat, most recent message first. Empty output means "no updates
// available right now" (caller decides whether to retry); warns only on a
// hard Telegram API error.
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

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
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
      `  press Enter once everyone has sent it (auto-continues after ${waitSeconds}s)... `,
      () => {
        clearTimeout(timer);
        rl.close();
        resolve();
      }
    );
  });
}

// discoverChatIds <botToken> — calls Telegram's getUpdates with the bot's OWN
// token (fetched from the platform, see stageResolve) to find everyone who
// has /start-ed it, then auto-fills any of TELEGRAM_CHAT_ID /
// TELEGRAM_CHAT_ID_2 that were left unset. Explicit env vars always win —
// discovery only fills gaps. Safe to skip: on any failure (placeholder
// token, no updates yet) it just warns and leaves the vars as they were.
//
// getUpdates and an active webhook are mutually exclusive on the SAME bot
// token (Telegram returns 409 "Conflict"), and telegram-transform-reply
// registers one. So: capture the current webhook (getWebhookInfo), clear it
// (deleteWebhook) to unblock polling, then restore the exact same URL
// afterward — BRIDGE_RESTORE_WEBHOOK=0 skips the restore if you'd rather
// leave the bot in polling mode.
//
// IMPORTANT: updates already pushed through an active webhook are consumed —
// Telegram does NOT replay them via getUpdates once the webhook is cleared,
// not even ones sent BEFORE this run started. So if a webhook was active, any
// /start sent earlier is unrecoverable; only messages sent AFTER the webhook
// drops will show up.
async function discoverChatIds(botToken: string): Promise<void> {
  if (TELEGRAM_CHAT_ID && TELEGRAM_CHAT_ID_2) {
    return;
  }
  if (!botToken || botToken.startsWith("PLACEHOLDER:")) {
    warn(
      "telegram account has no real bot token — cannot auto-discover chat_ids"
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
    log(
      "ask everyone to send /start (or any message) to the bot NOW, after this line printed"
    );
    await promptOrWait(BRIDGE_DISCOVER_WAIT_SECONDS);

    // Telegram can lag a moment before a just-sent message shows up in
    // getUpdates; retry a handful of times rather than a single shot.
    for (let attempt = 0; attempt < 5; attempt++) {
      chats = await fetchTelegramChats(botToken);
      if (chats.length > 0) {
        break;
      }
      await sleep(BRIDGE_DISCOVER_POLL_INTERVAL);
    }
  } else {
    chats = await fetchTelegramChats(botToken);
  }

  if (chats.length === 0) {
    warn(
      "no Telegram chats found — have the recipient(s) send /start to the bot, then re-run"
    );
  } else {
    log("discovered telegram chats (most recent first):");
    for (const chat of chats) {
      log(`  chat_id=${chat.id}  (${chat.label})`);
    }

    if (!TELEGRAM_CHAT_ID) {
      TELEGRAM_CHAT_ID = chats[0].id;
      log(
        `auto-selected TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID} (most recent chat)`
      );
    }
    if (!TELEGRAM_CHAT_ID_2) {
      const next = chats.find((c) => c.id !== TELEGRAM_CHAT_ID);
      if (next) {
        TELEGRAM_CHAT_ID_2 = next.id;
        log(
          `auto-selected TELEGRAM_CHAT_ID_2=${TELEGRAM_CHAT_ID_2} (next most recent distinct chat)`
        );
      }
    }
  }

  if (webhookUrl) {
    if (BRIDGE_RESTORE_WEBHOOK === "1") {
      log(`restoring webhook -> ${webhookUrl}`);
      await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
    } else {
      warn(
        "BRIDGE_RESTORE_WEBHOOK=0 — webhook left cleared; call setWebhook manually to restore delivery (see integrations/channels/telegram-transform-reply/README.md 'Run / exercise'). Re-applying the manifest against the existing account does NOT re-register the webhook (self-registration runs only on channel-account creation); a manifest path exists only if you delete the channel account and re-apply."
      );
    }
  }
}

// ----- Stage 2: resolve dependency ids (telegram account + http instance) --
async function stageResolve(): Promise<void> {
  step("2/3 resolve telegram account + http instance");

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
      "Provision one first:  env 'telegram-bot-token=...' yoizen manifests apply -f integrations/channels/telegram-transform-reply/manifest.yaml --secrets-from-env"
    );
    err("or pin one with TG_ACCOUNT_ID=<id>.");
    process.exit(1);
  }
  log(`telegram account=${TG_ACCOUNT_ID}`);

  const tgBotToken =
    tgAccounts.find((a) => a.id === TG_ACCOUNT_ID)?.accessToken ?? "";
  await discoverChatIds(tgBotToken);

  if (!TELEGRAM_CHAT_ID) {
    err("TELEGRAM_CHAT_ID is required and could not be auto-discovered.");
    err("DM your bot first, then re-run — or set TELEGRAM_CHAT_ID manually.");
    process.exit(1);
  }

  // The workflow always builds the notify branch (two parallel recipients),
  // even if a second chat_id was never found — notifySecondary just gets the
  // same chat_id as notifyPrimary (both arms send, both land in the same
  // chat) until you swap in the real second id via the UI.
  if (!TELEGRAM_CHAT_ID_2) {
    TELEGRAM_CHAT_ID_2 = TELEGRAM_CHAT_ID;
    warn(
      `no second chat_id found — wiring the branch with ${TELEGRAM_CHAT_ID} on BOTH arms; edit notifySecondary in the UI once you have a real second id`
    );
  }
  log(`telegram chat_ids=${TELEGRAM_CHAT_ID}, ${TELEGRAM_CHAT_ID_2}`);

  await ensureHttpAccount();
}

// buildWorkflowBody — assemble the workflow definition with resolved ids.
function buildWorkflowBody() {
  // channelSend.to only accepts a single string, so two recipients need a
  // branch with one channelSend arm per chat_id, not a comma-separated `to`.
  // Always built (even with a placeholder chatId2) so the canvas shape is
  // right from the start.
  const notifyArgs = {
    accountId: TG_ACCOUNT_ID,
    channel: "telegram",
    provider: "telegram",
    type: "text",
    text: "{{results.echo.text}}",
  };

  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "echo",
        activity: "jsFunction",
        args: { code: ECHO_CODE },
      },
      {
        name: "notify",
        activity: "branch",
        recipientA: [
          {
            name: "notifyPrimary",
            activity: "channelSend",
            args: { ...notifyArgs, to: TELEGRAM_CHAT_ID },
          },
        ],
        recipientB: [
          {
            name: "notifySecondary",
            activity: "channelSend",
            args: { ...notifyArgs, to: TELEGRAM_CHAT_ID_2 },
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
        ...(BRIDGE_PIN === "1" ? { accountIds: [httpAccountId] } : {}),
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
    "  echo    : jsFunction honors ctx.request.{text,from,metadata} + adds ISO timestamp/epoch ms"
  );
  log(
    `  notify  : branch (parallel) channelSend telegram -> chats ${TELEGRAM_CHAT_ID}, ${TELEGRAM_CHAT_ID_2}`
  );
  if (TELEGRAM_CHAT_ID_2 === TELEGRAM_CHAT_ID) {
    log(
      "            ^ no second chat_id found — both arms point at the same chat; edit notifySecondary in the UI"
    );
  }
  log(
    `  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)`
  );
  console.log();
  log(
    "Drive it — POST to THIS instance's own URL (no other http workflow fires):"
  );
  log(`    curl -X POST '${ingestUrl}' \\`);
  if (httpAppSecret) {
    log(`      -H 'x-http-channel-token: ${httpAppSecret}' \\`);
  } else {
    log(
      "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
    );
  }
  log("      -H 'content-type: application/json' \\");
  log(`      -d '{"from":"me","text":"hola"}'`);
  log(
    "Or just run ./run.sh, which resolves the token and posts a test payload for you."
  );
  log("Then check Telegram — the bot DMs you the echoed payload.");
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
