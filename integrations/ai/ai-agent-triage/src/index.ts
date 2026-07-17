/**
 * ai-agent-triage sample driver — SDK-powered replacement for the old
 * curl+jq `run.sh` body.
 *
 * Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
 * once first (see README.md). This script never creates or modifies platform
 * objects — it only:
 *   1. Lists workflows via `client.workflows.list()` to confirm the sample's
 *      workflow exists.
 *   2. Lists `channel: "http"` accounts via `client.channels.listAccounts()`
 *      to resolve the dedicated instance's `appSecret`.
 *   3. Posts sample customer messages through `client.webhooks.ingest()` —
 *      the generic `POST /webhooks/:channel/:tenantId/:instance` escape
 *      hatch, which accepts the same `x-http-channel-token` header the old
 *      bash script sent by hand.
 *
 * All configuration comes from environment variables, matching the names
 * `../lib/resolve-env.sh` exports and `.env.example` documents — this file
 * is invoked by `run.sh` after that resolution has already happened.
 */
import { createClient } from "@yoizen/platform-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  const workflowName = process.env.TRIAGE_WORKFLOW_NAME ?? "ai-agent-triage";
  // The apply engine derives a channel's externalId as `manifest:<name>`
  // (`channels-writer.ts`) — `manifest.yaml`'s channel name (`ai-agent-triage`)
  // becomes the externalId `manifest:ai-agent-triage`.
  const instanceExternalId =
    process.env.TRIAGE_HTTP_EXTERNAL_ID ?? "manifest:ai-agent-triage";
  const sendDelaySeconds = Number(process.env.TRIAGE_RUN_DELAY_S ?? "2");

  // The gateway's dev ingress routes by Host header (see
  // ../lib/resolve-env.sh); the SDK's fetch-based transport needs it passed
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

  console.log(
    `[run] 1/2 verifying workflow '${workflowName}' exists (apply manifest.yaml first if this fails)...`
  );
  let workflowId: string | undefined;
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === workflowName) {
      workflowId = workflow.id;
      break;
    }
  }
  if (!workflowId) {
    console.error(
      `[run] workflow '${workflowName}' not found — apply manifest.yaml first`
    );
    process.exit(1);
  }
  console.log(`[run]     workflow found (id=${workflowId})`);

  let appSecret: string | undefined;
  for await (const account of client.channels.listAccounts({
    channel: "http",
  })) {
    if (account.externalId === instanceExternalId) {
      appSecret = account.appSecret ?? undefined;
      break;
    }
  }
  if (!appSecret) {
    console.error(
      `[run] could not resolve the '${instanceExternalId}' instance token — apply manifest.yaml first`
    );
    process.exit(1);
  }

  const instanceUrl = `${baseUrl}/api/webhooks/http/${tenant}/${instanceExternalId}`;
  console.log(
    `[run] 2/2 posting sample customer messages to the dedicated instance URL: ${instanceUrl}`
  );

  // sendMessage <from> <text> — each POST triggers one full triage run:
  // agentCall classification -> jsFunction parse -> Telegram notification.
  async function sendMessage(from: string, text: string): Promise<void> {
    console.log(`[run]   -> [${from}] ${text}`);
    const result = await client.webhooks.ingest({
      tenant,
      channel: "http",
      instance: instanceExternalId,
      headers: { "x-http-channel-token": appSecret as string },
      body: {
        from,
        text,
        metadata: { source: "ai-agent-triage/run.sh" },
      },
    });
    console.log(JSON.stringify(result));
  }

  await sendMessage(
    "angry-customer",
    "I want my money back RIGHT NOW. This is the THIRD time my order arrived broken and nobody answers my emails!"
  );
  await sleep(sendDelaySeconds);

  await sendMessage(
    "curious-customer",
    "Hi! Quick question — my order shipped on Monday, when should I expect it to arrive in Rosario?"
  );
  await sleep(sendDelaySeconds);

  await sendMessage(
    "happy-customer",
    "Just wanted to say the replacement arrived today and it works perfectly. Thanks for the great support!"
  );

  console.log(
    "[run] sent — check Telegram. Each message produces one triage summary like:"
  );
  console.log(
    '[run]   "🎧 Triage — priority: urgent | sentiment: negative | intent: refund"'
  );
  console.log(
    "[run]   followed by the one-line summary and the original text."
  );
  console.log(
    "[run] The agentCall goes through a real LLM, so allow a few seconds per message."
  );
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
