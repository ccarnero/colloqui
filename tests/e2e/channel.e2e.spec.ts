import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "bun:test";
import { getBaseUrl, httpPost, httpPatch, httpDelete } from "./helpers";
import { authHeaders, getTenant } from "./auth.setup";

const GW = getBaseUrl("api-gateway");

/** Minimal shape for `ChannelEnvelope` from @yoizen/shared (kept local for e2e deps). */
interface ChannelEnvelope {
  readonly kind: string;
  readonly channel: string;
  readonly tenantId?: string;
  readonly data?: Record<string, unknown>;
}

interface SendMessageResult {
  readonly success: boolean;
  readonly providerMessageId?: string;
  readonly error?: string;
  readonly timestamp: string;
}

interface ChannelAccount {
  readonly id: string;
  readonly channel: string;
  readonly appSecret?: string;
}

const REQUIRED_ENV_VARS = [
  "NGROK_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_TEST_NUMBER",
] as const;

const missingEnvVars = REQUIRED_ENV_VARS.filter(
  (k) => !process.env[k] || process.env[k]!.length === 0,
);

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Reads Server-Sent Events until `match` returns true or timeout.
 * O(n) in bytes read; line buffer uses a single carry string.
 */
async function readSseUntilMatch(
  url: string,
  headers: Record<string, string>,
  match: (env: ChannelEnvelope) => boolean,
  timeoutMs: number,
): Promise<ChannelEnvelope> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  const clear = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { ...headers, Accept: "text/event-stream" },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SSE ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("SSE response has no body");

    const decoder = new TextDecoder();
    let carry = "";

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(
            `Timed out after ${timeoutMs}ms waiting for SSE event`,
          );
        }
        throw err;
      }

      const { done, value } = chunk;
      if (done) break;

      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(line.startsWith("data: ") ? 6 : 5).trim();
        if (payload.length === 0 || payload === "[DONE]") continue;

        let env: ChannelEnvelope;
        try {
          env = JSON.parse(payload) as ChannelEnvelope;
        } catch {
          continue;
        }

        if (match(env)) {
          clear();
          controller.abort();
          return env;
        }
      }
    }

    throw new Error("SSE stream ended without a matching event");
  } finally {
    clear();
  }
}

async function telegramSetWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string,
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ["message", "channel_post"],
        max_connections: 40,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  return (await res.json()) as { ok: boolean; description?: string };
}

async function telegramDeleteWebhook(
  botToken: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/deleteWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  return (await res.json()) as { ok: boolean };
}

const accountIds = new Map<"telegram" | "whatsapp", string>();

const suite = missingEnvVars.length === 0 ? describe : describe.skip;

if (missingEnvVars.length > 0) {
  console.warn(
    `Skipping channel E2E: missing env ${missingEnvVars.join(", ")}`,
  );
}

suite("E2E: channel-service", () => {
  const tenant = getTenant();
  const ngrok = normalizeBaseUrl(process.env.NGROK_URL ?? "");
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? "";
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const waSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  const waVerify = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const waPhone = process.env.WHATSAPP_TEST_NUMBER ?? "";

  beforeAll(async () => {
    const h = await authHeaders();

    const tgCreate = await httpPost<ChannelAccount>(
      `${GW}/channels/accounts`,
      {
        channel: "telegram",
        provider: "telegram",
        name: "e2e-telegram",
        externalId: `e2e-tg-${tenant}`,
        telegramBotToken: telegramToken,
        accessToken: telegramToken,
        isActive: false,
      },
      { headers: h },
    );
    expect(tgCreate.status).toBe(201);
    expect(tgCreate.body.id).toBeDefined();
    accountIds.set("telegram", tgCreate.body.id);

    const secret = tgCreate.body.appSecret;
    expect(secret).toBeDefined();

    const webhookUrl = `${ngrok}/api/webhooks/telegram/${encodeURIComponent(tenant)}`;
    const setResult = await telegramSetWebhook(
      telegramToken,
      webhookUrl,
      secret ?? "",
    );
    expect(setResult.ok).toBe(true);

    const tgPatch = await httpPatch<ChannelAccount>(
      `${GW}/channels/accounts/${encodeURIComponent(tgCreate.body.id)}`,
      { isActive: true },
      { headers: h },
    );
    expect(tgPatch.status).toBe(200);

    const waCreate = await httpPost<ChannelAccount>(
      `${GW}/channels/accounts`,
      {
        channel: "whatsapp",
        provider: "meta",
        name: "e2e-whatsapp",
        externalId: `e2e-wa-${tenant}`,
        phoneNumberId: waPhoneId,
        accessToken: waToken,
        appSecret: waSecret,
        verifyToken: waVerify,
        isActive: true,
      },
      { headers: h },
    );
    expect(waCreate.status).toBe(201);
    expect(waCreate.body.id).toBeDefined();
    accountIds.set("whatsapp", waCreate.body.id);
  });

  afterAll(async () => {
    const h = await authHeaders();

    await telegramDeleteWebhook(telegramToken).catch(() => undefined);

    const tgId = accountIds.get("telegram");
    if (tgId) {
      await httpDelete(`${GW}/channels/accounts/${encodeURIComponent(tgId)}`, {
        headers: h,
      }).catch(() => undefined);
    }

    const waId = accountIds.get("whatsapp");
    if (waId) {
      await httpDelete(`${GW}/channels/accounts/${encodeURIComponent(waId)}`, {
        headers: h,
      }).catch(() => undefined);
    }

    accountIds.clear();
  });

  describe("Telegram", () => {
    it(
      "should send an outgoing text message",
      async () => {
        const h = await authHeaders();
        const id = accountIds.get("telegram");
        expect(id).toBeDefined();

        const { status, body } = await httpPost<SendMessageResult>(
          `${GW}/channels/${encodeURIComponent(id!)}/messages`,
          {
            to: telegramChatId,
            type: "text",
            text: `E2E channel-service ${Date.now()}`,
          },
          { headers: h },
        );

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.providerMessageId).toBeDefined();
      },
      { timeout: 60_000 },
    );

    it(
      "should receive an incoming message via webhook (manual send)",
      async () => {
        const h = await authHeaders();
        const streamUrl = `${GW}/channels/stream`;

        console.warn(
          "\n[Telegram E2E] Send any message to your Telegram bot now (120s)...\n",
        );

        const env = await readSseUntilMatch(
          streamUrl,
          h,
          (e) =>
            e.channel === "telegram" &&
            e.kind === "received" &&
            e.tenantId === tenant,
          120_000,
        );

        expect(env.kind).toBe("received");
        expect(env.channel).toBe("telegram");
      },
      { timeout: 150_000 },
    );
  });

  describe("WhatsApp", () => {
    it(
      "should send an outgoing text message",
      async () => {
        const h = await authHeaders();
        const id = accountIds.get("whatsapp");
        expect(id).toBeDefined();

        const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
        const templateLanguage =
          process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en";

        let payload: Record<string, unknown>;

        if (templateName) {
          payload = {
            to: waPhone,
            type: "template",
            templateName,
            templateLanguage,
          };
        } else {
          payload = {
            to: waPhone,
            type: "text",
            text: `E2E channel-service ${Date.now()}`,
          };
        }

        const { status, body } = await httpPost<SendMessageResult>(
          `${GW}/channels/${encodeURIComponent(id!)}/messages`,
          payload,
          { headers: h },
        );

        expect(status).toBe(200);
        if (!body.success) {
          console.warn(
            `WhatsApp send failed: ${body.error ?? "unknown"}. ` +
              "If outside the 24h window, set WHATSAPP_TEMPLATE_NAME (+ optional WHATSAPP_TEMPLATE_LANGUAGE).",
          );
        }
        expect(body.success).toBe(true);
        expect(body.providerMessageId).toBeDefined();
      },
      { timeout: 60_000 },
    );

    it(
      "should receive an incoming message via webhook (manual send)",
      async () => {
        const h = await authHeaders();
        const streamUrl = `${GW}/channels/stream`;

        console.warn(
          "\n[WhatsApp E2E] Send a WhatsApp message to the business number now (120s)...\n",
        );

        const env = await readSseUntilMatch(
          streamUrl,
          h,
          (e) =>
            e.channel === "whatsapp" &&
            e.kind === "received" &&
            e.tenantId === tenant,
          120_000,
        );

        expect(env.kind).toBe("received");
        expect(env.channel).toBe("whatsapp");
      },
      { timeout: 150_000 },
    );
  });
});
