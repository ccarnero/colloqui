/**
 * Telegram chat_id discovery (raw Telegram Bot API, not SDK-covered) — same
 * contract as ../../http-bridge/src/setup.ts's discoverChatIds, but resolves
 * a SINGLE chat_id (this sample only ever notifies one recipient) instead of
 * a pair. Talks directly to api.telegram.org via fetch(); that's Telegram's
 * own Bot API, not part of @yoizen/platform-sdk.
 */
import * as readline from "node:readline";
import { log, sleep, warn } from "./log.js";

export interface TelegramChat {
  id: string;
  label: string;
  date: number;
}

/**
 * fetchTelegramChats <botToken> — one getUpdates call, returns one row per
 * distinct chat, most recent message first. Empty output means "no updates
 * available right now" (caller decides whether to retry); warns only on a
 * hard Telegram API error.
 */
export async function fetchTelegramChats(
  botToken: string
): Promise<TelegramChat[]> {
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

/**
 * promptOrWait — interactive shells get a blocking "press Enter" prompt
 * capped by waitSeconds (so it can't hang forever); non-interactive shells
 * just sleep that same duration.
 */
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
      `  press Enter once you have sent it (auto-continues after ${waitSeconds}s)... `,
      () => {
        clearTimeout(timer);
        rl.close();
        resolve();
      }
    );
  });
}

export interface DiscoverChatIdOptions {
  botToken: string;
  currentChatId: string;
  waitSeconds: number;
  pollIntervalSeconds: number;
  restoreWebhook: boolean;
}

/**
 * discoverChatId — calls Telegram's getUpdates with the bot's OWN token
 * (fetched from the platform, see stageResolve in setup.ts) to auto-fill
 * TELEGRAM_CHAT_ID ONLY when it is unset. An explicit env var always wins —
 * discovery only fills a gap. Safe to skip: on any failure (placeholder
 * token, no updates yet) it just warns and returns the input unchanged.
 *
 * getUpdates and an active webhook are mutually exclusive on the SAME bot
 * token (Telegram returns 409 "Conflict"), and telegram-transform-reply
 * registers one. So: capture the current webhook (getWebhookInfo), clear it
 * (deleteWebhook) to unblock polling, then restore the exact same URL
 * afterward — restoreWebhook=false skips the restore if you'd rather leave
 * the bot in polling mode.
 *
 * IMPORTANT: updates already pushed through an active webhook are consumed —
 * Telegram does NOT replay them via getUpdates once the webhook is cleared,
 * not even ones sent BEFORE this run started. So if a webhook was active, any
 * /start sent earlier is unrecoverable; only messages sent AFTER the webhook
 * drops will show up.
 */
export async function discoverChatId(
  opts: DiscoverChatIdOptions
): Promise<string> {
  if (opts.currentChatId) {
    return opts.currentChatId;
  }
  if (!opts.botToken || opts.botToken.startsWith("PLACEHOLDER:")) {
    warn(
      "telegram account has no real bot token — cannot auto-discover chat_id"
    );
    return opts.currentChatId;
  }

  const webhookInfoResp = await fetch(
    `https://api.telegram.org/bot${opts.botToken}/getWebhookInfo`
  );
  const webhookInfo = (await webhookInfoResp.json()) as {
    result?: { url?: string };
  };
  const webhookUrl = webhookInfo.result?.url ?? "";

  if (webhookUrl) {
    log(`clearing active webhook (${webhookUrl}) so getUpdates can poll`);
    await fetch(`https://api.telegram.org/bot${opts.botToken}/deleteWebhook`);
  }

  let chats: TelegramChat[] = [];
  if (webhookUrl) {
    warn(
      "the webhook was already delivering — any /start sent BEFORE this point is gone and will NOT be found"
    );
    log("send /start (or any message) to the bot NOW, after this line printed");
    await promptOrWait(opts.waitSeconds);

    // Telegram can lag a moment before a just-sent message shows up in
    // getUpdates; retry a handful of times rather than a single shot.
    for (let attempt = 0; attempt < 5; attempt++) {
      chats = await fetchTelegramChats(opts.botToken);
      if (chats.length > 0) {
        break;
      }
      await sleep(opts.pollIntervalSeconds);
    }
  } else {
    chats = await fetchTelegramChats(opts.botToken);
  }

  let chatId = opts.currentChatId;
  if (chats.length === 0) {
    warn("no Telegram chats found — send /start to the bot, then re-run");
  } else {
    log("discovered telegram chats (most recent first):");
    for (const chat of chats) {
      log(`  chat_id=${chat.id}  (${chat.label})`);
    }
    chatId = chats[0].id;
    log(`auto-selected TELEGRAM_CHAT_ID=${chatId} (most recent chat)`);
  }

  if (webhookUrl) {
    if (opts.restoreWebhook) {
      log(`restoring webhook -> ${webhookUrl}`);
      await fetch(
        `https://api.telegram.org/bot${opts.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
    } else {
      warn(
        "SYSVARS_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh or set it again manually when done polling"
      );
    }
  }

  return chatId;
}
