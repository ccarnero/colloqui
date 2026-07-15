/**
 * http-bridge sample driver — SDK-powered replacement for the old curl+jq
 * `run.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * Prerequisite: run ./setup.sh once first to provision the workflow and its
 * dedicated HTTP channel instance. This script never creates or modifies
 * platform objects — it only:
 *   1. Logs in and lists workflows via `client.workflows.list()` to confirm
 *      the sample's workflow exists.
 *   2. Lists `channel: "http"` accounts via `client.channels.listAccounts()`
 *      to resolve the dedicated instance's `appSecret`.
 *   3. Posts a test payload through `client.webhooks.ingest()` — the generic
 *      `POST /webhooks/:channel/:tenantId/:instance` escape hatch, which
 *      accepts the same `x-http-channel-token` header the old bash script
 *      sent by hand.
 *
 * All configuration comes from environment variables, matching the names
 * `run.sh`'s inlined dev-environment resolver exports and `.env.example`
 * documents — this file is invoked by `run.sh` after that resolution has
 * already happened.
 */
import { createClient } from "@yoizen/platform-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  const workflowName = process.env.BRIDGE_WORKFLOW_NAME ?? "http-bridge";
  const instanceExternalId =
    process.env.BRIDGE_HTTP_EXTERNAL_ID ?? "http-bridge";
  const runText = process.env.RUN_TEXT ?? "hola desde run.sh";

  // The gateway's dev ingress routes by Host header (see run.sh's inlined
  // dev-environment resolver); the SDK's fetch-based transport needs it
  // passed as a regular header since we're talking to a bare IP/localhost port.
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
    `[run] 1/2 verifying workflow '${workflowName}' exists (run ./setup.sh first if this fails)...`
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
      `[run] workflow '${workflowName}' not found — run ./setup.sh first`
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
      `[run] could not resolve the '${instanceExternalId}' instance token — run ./setup.sh first`
    );
    process.exit(1);
  }

  const messageText = `${runText} [${Math.floor(Date.now() / 1000)}]`;
  const instanceUrl = `${baseUrl}/api/webhooks/http/${tenant}/${instanceExternalId}`;

  console.log(
    `[run] 2/2 posting test payload to the dedicated instance URL: ${instanceUrl}`
  );
  const result = await client.webhooks.ingest({
    tenant,
    channel: "http",
    instance: instanceExternalId,
    headers: { "x-http-channel-token": appSecret },
    body: {
      from: "run.sh",
      text: messageText,
      metadata: { source: "http-bridge/run.sh" },
    },
  });

  console.log(JSON.stringify(result, null, 2));
  console.log(
    "[run] sent — check Telegram for the echoed payload + timestamp."
  );
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
