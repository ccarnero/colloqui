/**
 * telegram-transform-reply sample driver — the RUN side that EXERCISES the
 * already-provisioned resources (provisioning itself is now declarative, via
 * `manifest.yaml` + `yoizen manifests apply`; see README.md).
 *
 * The deleted `setup.ts` used to both provision AND (optionally) drive the
 * chain with a synthetic inbound update. Provisioning moved to the manifest;
 * this file preserves ONLY the exercise half — the stage-5 "simulate inbound"
 * drive — pointed at the manifest-provisioned account.
 *
 * The webhook secret (channel-service's per-account `appSecret`) is NOT
 * surfaced by `manifests apply`, so it is provided via the env var
 * `TELEGRAM_WEBHOOK_SECRET` here (the same way the bot token has always been
 * an env-supplied input) — no new platform mechanism is invented. Read it
 * from the account after apply (`GET /channels/accounts`), or mint one by
 * re-applying. Runs against the account externalId the manifest writer
 * derives: `manifest:telegram-transform-reply-bot`.
 */
import { createClient } from "@yoizen/platform-sdk";

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

// Account externalId the manifest apply engine derives from the channel name
// (`manifest:<channel.name>`), overridable if you renamed the channel.
const EXTERNAL_ID =
  process.env.TG_EXTERNAL_ID ?? "manifest:telegram-transform-reply-bot";
const WORKFLOW_NAME =
  process.env.TG_WORKFLOW_NAME ?? "telegram-transform-reply";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const TELEGRAM_TEST_CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID ?? "";
const POLL_TIMEOUT_S = Number(process.env.TG_POLL_TIMEOUT_S ?? "60");

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see ../../lib/resolve-env.sh);
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

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function resolveWorkflowId(): Promise<string> {
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === WORKFLOW_NAME) {
      return workflow.id;
    }
  }
  fail(
    `workflow '${WORKFLOW_NAME}' not found — apply manifest.yaml first (see README.md).`
  );
}

async function simulateInbound(): Promise<void> {
  step("simulate inbound Telegram update against the provisioned account");
  if (!WEBHOOK_SECRET) {
    fail(
      "TELEGRAM_WEBHOOK_SECRET is required — the account's webhook appSecret " +
        "(GET /channels/accounts after apply). It signs the synthetic update."
    );
  }
  if (!TELEGRAM_TEST_CHAT_ID) {
    fail(
      "TELEGRAM_TEST_CHAT_ID is required — your real numeric chat id. A fake " +
        "id makes the workflow run but Telegram rejects the reply with " +
        "'Bad Request: chat not found'."
    );
  }

  const workflowId = await resolveWorkflowId();
  log(`workflow '${WORKFLOW_NAME}' id=${workflowId}`);

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
    headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
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
    for await (const execution of client.workflows.listExecutions(workflowId, {
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

async function main(): Promise<void> {
  console.log(
    "[run] exercising the manifest-provisioned Telegram account + workflow..."
  );
  console.log(
    "[run] (provisioning is declarative now: `yoizen manifests apply -f manifest.yaml --secrets-from-env` — see README.md)"
  );
  await simulateInbound();
  console.log();
  log(
    "Done. To exercise interactively instead, just message your bot — it replies " +
      "'Echo: <your text> — processed at <ISO ms> (epoch_ms=...)'."
  );
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
