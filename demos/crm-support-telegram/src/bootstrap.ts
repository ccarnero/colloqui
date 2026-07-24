/**
 * bootstrap — the ONLY provisioning script left after the manifest migration
 * (manual-loops/crm-support-telegram.md T04, decision 4). Carries EXCLUSIVELY
 * the items the T01 audit dispositioned as genuinely out-of-band for the
 * manifest engine — everything else moved to `manifest.yaml`
 * (`yoizen manifests apply -f manifest.yaml --secrets-from-env`).
 *
 * Verified before writing this file (do not re-derive without checking):
 * `services/provisioning-service/src/modules/apply/infrastructure/
 * channels-writer.ts` never calls the Telegram Bot API (`rg -rn
 * "telegram.org|setWebhook|getUpdates"
 * services/provisioning-service/src/` — zero matches) — it only creates/
 * updates the platform's own `channel_accounts` row. Webhook registration and
 * chat-id discovery genuinely have no manifest-engine path.
 *
 * Three stages, matching the T01 name inventory's out-of-band disposition
 * list exactly (manual-loops/crm-support-telegram.md, "Out-of-band
 * disposition summary"):
 *   1. Build + tag the `priority-scorer` Docker image
 *      (`dev.local/priority-scorer:local`) — `registry-services-writer.ts`
 *      only supports `image` (a pre-built ref), never `buildRef`
 *      (`services/provisioning-service/.../registry-services-writer.ts`
 *      "registry-service has no buildRef -> image resolution path yet").
 *   2. Ensure the HubSpot custom contact property `telegram_user_id` — the
 *      Properties API is a one-time schema-mutation call, not one of the
 *      5 declared `demo-hubspot` connector endpoints.
 *   3. Register the Telegram webhook + resolve `TELEGRAM_TEST_CHAT_ID` —
 *      direct Telegram Bot API calls, not platform resources.
 *
 * Adapted from the deleted `04-priority-scorer.ts` (Stage 3's docker build),
 * `02-hubspot-connector.ts` (Stage 3's property ensure) and
 * `01-telegram-channel.ts` (Stages 3-4's webhook registration/chat-id
 * discovery) — copied and adapted, NOT imported across trees
 * (`demos/README.md`). Run AFTER `manifests apply` (the webhook stage reads
 * the manifest-created Telegram channel account by name), per the
 * bootstrap -> apply -> run order this README documents.
 *
 * IDEMPOTENT: the image build is a plain `docker build` re-tag (safe to
 * re-run); the HubSpot property ensure is create-if-missing (existing
 * GET short-circuits); the webhook registration only re-registers when the
 * live Telegram webhook URL differs, and chat-id discovery prefers an
 * explicit env var or a prior cached discovery before polling again.
 */
import { execFileSync } from "node:child_process";
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
const repoRoot = path.resolve(demoDir, "../..");
const dockerfilePath = "demos/crm-support-telegram/priority-scorer/Dockerfile";

const SCORER_IMAGE_TAG = process.env.SCORER_IMAGE_TAG ?? "local";
const SCORER_IMAGE_REF = `dev.local/priority-scorer:${SCORER_IMAGE_TAG}`;

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const TELEGRAM_USER_ID_PROPERTY = "telegram_user_id";

// Same slug the manifest declares (`manifest.yaml`'s `channels[0].name`) —
// this is the ONLY place bootstrap.ts needs to know it, so it stays a plain
// constant rather than a shared import (demos copy, never cross-import code).
const TELEGRAM_CHANNEL_NAME = "crm-support-telegram-bot";

const CHAT_ID_CACHE_FILE =
  process.env.TG_CHAT_ID_CACHE_FILE ??
  path.join(demoDir, ".telegram-test-chat-id");

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

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

interface TelegramChat {
  id: string;
  label: string;
  date: number;
}

// Adapted verbatim from the deleted `01-telegram-channel.ts`.
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

export interface BootstrapResult {
  imageRef: string;
  hubspotPropertyEnsured: boolean;
  webhookRegistered: boolean;
  testChatId: string;
}

export async function main(): Promise<BootstrapResult> {
  // ----- Stage 1: preflight -------------------------------------------------
  const {
    tenant,
    email,
    password,
    baseUrl,
    hostHeader,
    hubspotServiceKey,
    botToken,
    publicUrl,
  } = await runStage("preflight", async () => {
    const tenant = requireEnv("YOIZEN_TENANT");
    const email = requireEnv("YOIZEN_EMAIL");
    const password = requireEnv("YOIZEN_PASSWORD");
    const baseUrl = requireEnv("YOIZEN_BASE_URL");
    const hubspotServiceKey = requireEnv("HUBSPOT_SERVICE_KEY");
    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const publicUrl = requireEnv("TG_PUBLIC_URL");
    const hostHeader = process.env.YOIZEN_HOST_HEADER;
    log(
      `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  image=${SCORER_IMAGE_REF}`
    );
    return {
      tenant,
      email,
      password,
      baseUrl,
      hostHeader,
      hubspotServiceKey,
      botToken,
      publicUrl,
    };
  });

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

  // ----- Stage 2: build + tag the priority-scorer image ----------------------
  await runStage(`build image '${SCORER_IMAGE_REF}'`, async () => {
    log(`docker build -f ${dockerfilePath} -t ${SCORER_IMAGE_REF} ${repoRoot}`);
    try {
      execFileSync(
        "docker",
        ["build", "-f", dockerfilePath, "-t", SCORER_IMAGE_REF, repoRoot],
        { cwd: repoRoot, stdio: "inherit" }
      );
    } catch (e) {
      fail(`docker build FAILED: ${messageOf(e)}`);
    }
    log(`image built: ${SCORER_IMAGE_REF}`);
  });

  // ----- Stage 3: ensure the telegram_user_id custom contact property -------
  const hubspotPropertyEnsured = await runStage(
    `ensure custom contact property '${TELEGRAM_USER_ID_PROPERTY}'`,
    async () => {
      const propertyUrl = `${HUBSPOT_API_BASE}/crm/v3/properties/contacts/${TELEGRAM_USER_ID_PROPERTY}`;
      const getResp = await fetch(propertyUrl, {
        headers: { Authorization: `Bearer ${hubspotServiceKey}` },
      });

      if (getResp.ok) {
        log(`property '${TELEGRAM_USER_ID_PROPERTY}' already exists — reused`);
        return true;
      }
      if (getResp.status !== 404) {
        const body = await getResp.text();
        fail(
          `unexpected response checking property '${TELEGRAM_USER_ID_PROPERTY}': HTTP ${getResp.status} ${body}`
        );
      }

      log(`property '${TELEGRAM_USER_ID_PROPERTY}' not found — creating`);
      const createResp = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/properties/contacts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hubspotServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: TELEGRAM_USER_ID_PROPERTY,
            label: "Telegram User ID",
            type: "string",
            fieldType: "text",
            groupName: "contactinformation",
            description:
              "Telegram chat/user id — search key used by the crm-support-telegram demo's search-contact endpoint.",
          }),
        }
      );

      if (createResp.status === 409) {
        warn(
          `property '${TELEGRAM_USER_ID_PROPERTY}' create returned 409 — raced with a concurrent run, treating as reused`
        );
        return true;
      }
      if (!createResp.ok) {
        const body = await createResp.text();
        fail(`property create FAILED: HTTP ${createResp.status} ${body}`);
      }
      log(`property '${TELEGRAM_USER_ID_PROPERTY}' created`);
      return true;
    }
  );

  // ----- Stage 4: resolve the manifest-created Telegram channel account -----
  const { channelExternalId, appSecret } = await runStage(
    `resolve manifest-created channel '${TELEGRAM_CHANNEL_NAME}'`,
    async () => {
      const accounts: ChannelAccount[] = [];
      for await (const account of client.channels.listAccounts({
        channel: "telegram",
      })) {
        accounts.push(account);
      }
      const account = accounts.find((a) => a.name === TELEGRAM_CHANNEL_NAME);
      if (!account) {
        fail(
          `channel account '${TELEGRAM_CHANNEL_NAME}' not found — run 'yoizen manifests apply' first (bootstrap -> apply -> run order; this stage reads the manifest-created account, it does not create one)`
        );
      }
      log(
        `resolved channel '${TELEGRAM_CHANNEL_NAME}' externalId='${account.externalId}'`
      );
      if (!account.appSecret) {
        warn(
          "manifest-created account exposes no appSecret — webhook registration will be skipped"
        );
      }
      return {
        channelExternalId: account.externalId,
        appSecret: account.appSecret ?? "",
      };
    }
  );

  // ----- Stage 5: register the Telegram webhook ------------------------------
  const webhookRegistered = await runStage(
    "register telegram webhook",
    async () => {
      // NOTE the /api prefix — the gateway has a global prefix `api` (see
      // the deleted 01-telegram-channel.ts / telegram-transform-reply/src/setup.ts).
      const webhookPath = `/api/webhooks/telegram/${tenant}/${channelExternalId}`;
      const cleanPublicUrl = publicUrl.replace(/\/$/, "");
      const url = cleanPublicUrl.endsWith(webhookPath)
        ? cleanPublicUrl
        : `${cleanPublicUrl}${webhookPath}`;

      if (!appSecret) {
        warn("no appSecret available — skipping webhook registration");
        return false;
      }

      const infoResp = await fetch(
        `https://api.telegram.org/bot${botToken}/getWebhookInfo`
      );
      const info = (await infoResp.json()) as { result?: { url?: string } };
      if (info.result?.url === url) {
        log(`webhook already registered -> ${url} — no-op`);
        return true;
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

  // ----- Stage 6: resolve TELEGRAM_TEST_CHAT_ID (run-side value) ------------
  const testChatId = await runStage(
    "resolve TELEGRAM_TEST_CHAT_ID",
    async () => {
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
          await sleep(10);
        }
      }

      if (activeWebhookUrl) {
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
    }
  );

  return {
    imageRef: SCORER_IMAGE_REF,
    hubspotPropertyEnsured,
    webhookRegistered,
    testChatId,
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
      log(`image_ref=${result.imageRef}`);
      log(`hubspot_property_ensured=${result.hubspotPropertyEnsured}`);
      log(`webhook_registered=${result.webhookRegistered}`);
      log(`test_chat_id=${result.testChatId}`);
    })
    .catch((e) => {
      fail(`bootstrap failed: ${e instanceof Error ? e.message : e}`);
    });
}
