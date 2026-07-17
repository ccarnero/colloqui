/**
 * http-fanout-telegram sample driver — the RUN side that EXERCISES the
 * already-provisioned resources (provisioning itself is declarative now, via
 * `manifest.yaml` + `yoizen manifests apply`; see README.md).
 *
 * This script:
 *   1. Verifies (read-only, via the SDK) that the four connector prerequisites
 *      (`jsonplaceholder`/`pokeapi`/`catfacts`/`httpbin`) already exist live —
 *      they are owned by `../../http/http-connectors`'s `manifest.yaml` (a
 *      `LibraryManifest`, declarative since its migration), never created or
 *      shelled-out-to from here. Fails fast with a clear message if any is
 *      missing, telling the user to apply that manifest first.
 *   2. Verifies (read-only) that an active Telegram channel account exists —
 *      it no longer shells out to `../telegram-transform-reply/setup.ts`,
 *      deleted when that sample migrated to `manifest.yaml`
 *      (`yoizen manifests apply -f ../telegram-transform-reply/manifest.yaml
 *      --secrets-from-env` provisions it instead; see README.md §
 *      Prerequisites).
 *   3. Logs in and lists workflows via `client.workflows.list()` to confirm
 *      this sample's own manifest-provisioned workflow exists.
 *   4. Lists `channel: "http"` accounts via `client.channels.listAccounts()`
 *      to resolve the dedicated instance's `appSecret`.
 *   5. Posts a test payload through `client.webhooks.ingest()` — the generic
 *      `POST /webhooks/:channel/:tenantId[/:instance]` escape hatch — to the
 *      dedicated instance URL, falling back to the legacy tenant-only URL
 *      (omitting `instance`) if the instance URL isn't accepted.
 *
 * All configuration comes from environment variables, matching the names
 * `../lib/resolve-env.sh` exports and `.env.example` documents — this file
 * is invoked by `run.sh` after that resolution has already happened.
 */
import { createClient } from "@yoizen/platform-sdk";

// The four http-connectors connectors this workflow's `connectorRef`
// substitutions target (manifest.yaml's `connectors:` section, all
// `external: true`) — see http-connectors/manifest.yaml.
const REQUIRED_CONNECTOR_NAMES = [
  "jsonplaceholder",
  "pokeapi",
  "catfacts",
  "httpbin",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function step(msg: string): void {
  console.log(`[run] ${msg}`);
}

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  const workflowName =
    process.env.FANOUT_WORKFLOW_NAME ?? "http-fanout-telegram";
  // The apply engine derives a channel's externalId as `manifest:<name>`
  // (see manifest.yaml's channel `http-fanout-telegram`) — NOT the bare name
  // the deleted setup.ts used directly as its externalId.
  const instanceExternalId =
    process.env.FANOUT_HTTP_EXTERNAL_ID ?? "manifest:http-fanout-telegram";
  const runText = process.env.RUN_TEXT ?? "hola desde run.sh";

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

  // ----- 1. Prerequisites (read-only check, no shell-out) --------------------
  step(
    "1/3 checking connectors (jsonplaceholder/pokeapi/catfacts/httpbin) exist..."
  );
  const liveConnectorNames = new Set<string>();
  for await (const connector of client.connectors.list({
    context: "external",
  })) {
    liveConnectorNames.add(connector.name);
  }
  const missingConnectors = REQUIRED_CONNECTOR_NAMES.filter(
    (name) => !liveConnectorNames.has(name)
  );
  if (missingConnectors.length > 0) {
    console.error(
      `[run] missing connector(s): ${missingConnectors.join(", ")} — apply ` +
        "../http/http-connectors/manifest.yaml --secrets-from-env first " +
        "(see ../../http/http-connectors/README.md)"
    );
    process.exit(1);
  }
  step("    connectors ready");

  step(
    "2/3 checking for an active telegram account (apply " +
      "../telegram-transform-reply/manifest.yaml first if this sample was " +
      "never provisioned)..."
  );

  let hasActiveTelegram = false;
  for await (const account of client.channels.listAccounts({
    channel: "telegram",
  })) {
    if (account.isActive) {
      hasActiveTelegram = true;
      break;
    }
  }
  if (!hasActiveTelegram) {
    console.error(
      "[run] no active telegram account found — apply " +
        "../telegram-transform-reply/manifest.yaml --secrets-from-env first"
    );
    process.exit(1);
  }
  step("    active telegram account found");

  // ----- 2. Login + verify workflow exists ------------------------------------
  step(
    `3/3 verifying workflow '${workflowName}' exists (apply manifest.yaml first if this fails)...`
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
      `[run] workflow '${workflowName}' not found — apply manifest.yaml first (see README.md)`
    );
    process.exit(1);
  }
  step(`    workflow found (id=${workflowId})`);

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
      `[run] could not resolve the '${instanceExternalId}' instance token — apply manifest.yaml first (see README.md)`
    );
    process.exit(1);
  }

  const messageText = `${runText} [${Math.floor(Date.now() / 1000)}]`;

  // ----- 3. Drive it -----------------------------------------------------------
  step(
    `driving via the dedicated instance URL: ${baseUrl}/api/webhooks/http/${tenant}/${instanceExternalId}`
  );
  let result = await client.webhooks.ingest({
    tenant,
    channel: "http",
    instance: instanceExternalId,
    headers: { "x-http-channel-token": appSecret },
    body: { from: "run.sh", text: messageText },
  });

  if (result.status !== "accepted") {
    step(
      "instance URL not accepted (needs the Option-B redeploy?) — using token-only legacy URL"
    );
    result = await client.webhooks.ingest({
      tenant,
      channel: "http",
      headers: { "x-http-channel-token": appSecret },
      body: { from: "run.sh", text: messageText },
    });
  }

  console.log(JSON.stringify(result, null, 2));
  step(
    "sent — check Telegram for the joined summary (post + pokemon + cat fact)."
  );
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
