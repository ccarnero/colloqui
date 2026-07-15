/**
 * 01-telegram-channel — provisions the customer-facing Telegram channel
 * account for the crm-support-telegram demo.
 *
 * Adapted from `integrations/channels/telegram-transform-reply/src/setup.ts` (account
 * create-or-update, webhook registration) and
 * `sdk/examples/reference-pattern/src/setup.ts` (`discoverChatIds` /
 * `fetchTelegramChats` — the "DM your bot first" chat-id auto-discovery via
 * raw Telegram `getUpdates`). Copied and adapted, NOT imported across trees
 * (`demos/README.md`).
 *
 * Stages:
 *   1. preflight            — validate required env
 *   2. ensure account       — create-or-update the telegram channel account,
 *                             identified by its (masked) bot token, not a
 *                             random externalId suffix
 *   3. resolve test chat id — TELEGRAM_TEST_CHAT_ID > TELEGRAM_CHAT_ID > a
 *                             cached prior discovery > live getUpdates
 *                             discovery; fails fast ("DM your bot first") if
 *                             none can be resolved
 *   4. register webhook     — POST setWebhook against TG_PUBLIC_URL
 *
 * IDEMPOTENT: re-running never duplicates the channel account (matched by
 * masked bot token) and never re-registers a webhook that already points at
 * the same URL with the same secret.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@yoizen/platform-sdk";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import { fail } from "./lib/fail.js";
import { log, step, warn } from "./lib/logging.js";
import { requireEnv } from "./lib/require-env.js";
import { runStage } from "./lib/run-stage.js";

// ----- Configuration (override via env) -------------------------------------
const demoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ACCOUNT_NAME = process.env.TG_ACCOUNT_NAME ?? "CRM Support Telegram Bot";
const EXTERNAL_PREFIX =
  process.env.TG_EXTERNAL_ID ?? "crm-support-telegram-bot";

const SECRET_FILE =
  process.env.TG_SECRET_FILE ?? path.join(demoDir, ".telegram-channel-secret");
const CHAT_ID_CACHE_FILE =
  process.env.TG_CHAT_ID_CACHE_FILE ??
  path.join(demoDir, ".telegram-test-chat-id");

const POLL_TIMEOUT_S = Number(process.env.TG_DISCOVER_WAIT_S ?? "60");
const RESTORE_WEBHOOK = process.env.TG_RESTORE_WEBHOOK ?? "1";

function saveToFile(file: string, value: string): void {
  if (!value) {
    return;
  }
  fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
}

function loadFromFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

export interface TelegramChannelResult {
  accountId: string;
  externalId: string;
  chatId: string;
  webhookRegistered: boolean;
}

interface TelegramChat {
  id: string;
  label: string;
  date: number;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// fetchTelegramChats — one getUpdates call, returns one row per distinct
// chat, most recent message first. Adapted from
// `sdk/examples/reference-pattern/src/setup.ts`.
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

export async function main(): Promise<TelegramChannelResult> {
  // ----- Stage 1: preflight -------------------------------------------------
  const { tenant, email, password, baseUrl, hostHeader, botToken, publicUrl } =
    await runStage("preflight", async () => {
      const tenant = requireEnv("YOIZEN_TENANT");
      const email = requireEnv("YOIZEN_EMAIL");
      const password = requireEnv("YOIZEN_PASSWORD");
      const baseUrl = requireEnv("YOIZEN_BASE_URL");
      const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
      const publicUrl = requireEnv("TG_PUBLIC_URL");
      const hostHeader = process.env.YOIZEN_HOST_HEADER;
      log(
        `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  TG_PUBLIC_URL=${publicUrl}`
      );
      return {
        tenant,
        email,
        password,
        baseUrl,
        hostHeader,
        botToken,
        publicUrl,
      };
    });

  // The gateway's dev ingress routes by Host header; the SDK's fetch-based
  // transport needs it passed as a regular header when talking to a bare
  // IP/localhost port (see telegram-transform-reply/src/setup.ts).
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

  // ----- Stage 2: ensure the Telegram channel account -----------------------
  const { accountId, externalId, appSecret } = await runStage(
    "ensure telegram channel account",
    async () => {
      const accounts: ChannelAccount[] = [];
      for await (const account of client.channels.listAccounts({
        channel: "telegram",
      })) {
        accounts.push(account);
      }

      // Collect ALL accounts already carrying this exact bot token, newest
      // first. `listAccounts`/`getAccount` return the RAW `accessToken`
      // (channel-service's `accounts.service.ts` maps `row.access_token`
      // straight through) — only the `/refresh-token` response masks it, and
      // that endpoint is meta-only — so a direct string comparison is the
      // correct "by bot token" identity check here. Also sweep any stale
      // prefix-matching accounts left by earlier runs so we never
      // accumulate duplicates.
      const byToken = accounts
        .filter((a) => a.isActive && a.accessToken === botToken)
        .reverse();
      const stalePrefixMatches = accounts
        .filter(
          (a) =>
            a.isActive &&
            a.accessToken !== botToken &&
            a.externalId.startsWith(EXTERNAL_PREFIX)
        )
        .reverse();

      const keep = byToken[0];
      const stale = [...byToken.slice(1), ...stalePrefixMatches];

      for (const account of stale) {
        log(`removing stale telegram account ${account.id}`);
        await client.channels.removeAccount(account.id).catch(() => undefined);
      }

      if (keep) {
        log(
          `reusing existing telegram account ${keep.id} externalId=${keep.externalId} (matched by bot token)`
        );
        await client.channels
          .updateAccount(keep.id, {
            name: ACCOUNT_NAME,
            accessToken: botToken,
            isActive: true,
          })
          .catch((e) => {
            fail(
              `Account update failed: ${e instanceof Error ? e.message : e}`
            );
          });
        log(`account ${keep.id} converged (name/isActive/accessToken)`);
        // The API returns the UNMASKED appSecret on every list/get row
        // (channel-service `accounts.service.ts` `mapRow`:
        // `appSecret: row.app_secret ?? undefined`), so prefer it — the
        // local file cache is only a last-resort fallback for the (rare)
        // case where the API somehow omitted it. This keeps the reuse path
        // working on a fresh checkout / CI runner that has no cached file.
        const reusedSecret = keep.appSecret ?? loadFromFile(SECRET_FILE);
        if (reusedSecret) {
          saveToFile(SECRET_FILE, reusedSecret);
        }
        return {
          accountId: keep.id,
          externalId: keep.externalId,
          appSecret: reusedSecret,
        };
      }

      const newExternalId = `${EXTERNAL_PREFIX}-${Math.floor(
        Date.now() / 1000
      )}-${Math.floor(Math.random() * 32768)}`;

      const created = await client.channels
        .createAccount({
          channel: "telegram",
          provider: "telegram",
          name: ACCOUNT_NAME,
          externalId: newExternalId,
          telegramBotToken: botToken,
          accessToken: botToken,
          isActive: true,
        })
        .catch((e) => {
          fail(
            `Account creation failed: ${e instanceof Error ? e.message : e}`
          );
        });
      if (!created?.id) {
        fail(`Account creation failed: ${JSON.stringify(created)}`);
      }
      const secret = created.appSecret ?? "";
      saveToFile(SECRET_FILE, secret);
      log(
        `created telegram account id=${created.id} externalId=${newExternalId}`
      );
      if (secret) {
        log("webhook secret captured + cached");
      } else {
        warn(
          "create response did not expose appSecret — webhook registration will be skipped"
        );
      }
      return {
        accountId: created.id,
        externalId: newExternalId,
        appSecret: secret,
      };
    }
  );

  // ----- Stage 3: resolve the test chat id ----------------------------------
  const chatId = await runStage("resolve TELEGRAM_TEST_CHAT_ID", async () => {
    const explicit =
      process.env.TELEGRAM_TEST_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";
    if (explicit) {
      log(`using explicit chat id ${explicit}`);
      saveToFile(CHAT_ID_CACHE_FILE, explicit);
      return explicit;
    }

    const cached = loadFromFile(CHAT_ID_CACHE_FILE);
    if (cached) {
      log(`using cached chat id ${cached} (from a prior discovery run)`);
      return cached;
    }

    log(
      "no TELEGRAM_TEST_CHAT_ID/TELEGRAM_CHAT_ID set — attempting discovery via getUpdates"
    );

    const webhookInfoResp = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    );
    const webhookInfo = (await webhookInfoResp.json()) as {
      result?: { url?: string };
    };
    const activeWebhookUrl = webhookInfo.result?.url ?? "";

    if (activeWebhookUrl) {
      log(
        `clearing active webhook (${activeWebhookUrl}) so getUpdates can poll`
      );
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
      warn(
        "any /start sent BEFORE this point while the webhook was active is gone and will NOT be found"
      );
    }

    let chats: TelegramChat[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      chats = await fetchTelegramChats(botToken);
      if (chats.length > 0) {
        break;
      }
      if (attempt < 4) {
        await sleep(Math.min(POLL_TIMEOUT_S / 5, 10));
      }
    }

    if (activeWebhookUrl && RESTORE_WEBHOOK === "1") {
      log(`restoring webhook -> ${activeWebhookUrl}`);
      await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(activeWebhookUrl)}`
      );
    }

    if (chats.length === 0) {
      fail(
        "TELEGRAM_TEST_CHAT_ID could not be resolved.\n" +
          "       DM your bot first, then re-run — or set TELEGRAM_TEST_CHAT_ID/TELEGRAM_CHAT_ID manually."
      );
    }

    log("discovered telegram chats (most recent first):");
    for (const chat of chats) {
      log(`  chat_id=${chat.id}  (${chat.label})`);
    }
    const resolved = chats[0].id;
    log(`auto-selected TELEGRAM_TEST_CHAT_ID=${resolved} (most recent chat)`);
    saveToFile(CHAT_ID_CACHE_FILE, resolved);
    return resolved;
  });

  // ----- Stage 4: register the Telegram webhook -----------------------------
  const webhookRegistered = await runStage(
    "register telegram webhook",
    async () => {
      // NOTE the /api prefix — the gateway has a global prefix `api`
      // (see telegram-transform-reply/src/setup.ts).
      const webhookPath = `/api/webhooks/telegram/${tenant}/${externalId}`;
      const cleanPublicUrl = publicUrl.replace(/\/$/, "");
      const url = cleanPublicUrl.endsWith(webhookPath)
        ? cleanPublicUrl
        : `${cleanPublicUrl}${webhookPath}`;

      if (!appSecret) {
        warn(
          "no appSecret available (reused account without a cached secret) — skipping webhook registration"
        );
        return false;
      }

      log(`setWebhook -> ${url}`);
      const resp = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          method: "POST",
          body: new URLSearchParams({
            url,
            secret_token: appSecret,
            allowed_updates: JSON.stringify(["message", "channel_post"]),
          }),
        }
      );
      const data = (await resp.json()) as {
        ok?: boolean;
        description?: string;
      };
      if (data.ok === true) {
        log("webhook registered with Telegram");
        return true;
      }
      warn(`setWebhook response: ${JSON.stringify(data)}`);
      return false;
    }
  );

  return { accountId, externalId, chatId, webhookRegistered };
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then((result) => {
      console.log();
      step("resolved artifacts");
      log(`account_id=${result.accountId}`);
      log(`external_id=${result.externalId}`);
      log(`test_chat_id=${result.chatId}`);
      log(`webhook_registered=${result.webhookRegistered}`);
    })
    .catch((e) => {
      fail(`01-telegram-channel failed: ${e instanceof Error ? e.message : e}`);
    });
}
