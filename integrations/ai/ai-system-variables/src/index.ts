/**
 * ai-system-variables sample driver — SDK-powered replacement for the old
 * curl+jq `run.sh` body.
 *
 * Provisioning is now declarative (`manifest.yaml` + `yoizen manifests
 * apply`, see README.md).
 *
 * Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
 * once first (see README.md). This script never creates or modifies
 * platform objects — it only:
 *   1. Verifies the sample's workflow exists via `client.workflows.list()`.
 *   2. Shows the CURRENT values of the three system variables via
 *      `client.systemVariables.list()` — they ARE the workflow's
 *      configuration.
 *   3. Resolves the dedicated HTTP instance's `appSecret` via
 *      `client.channels.listAccounts()` and posts two sample customer
 *      messages through `client.webhooks.ingest()`.
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

async function sendMessage(
  client: ReturnType<typeof createClient>,
  tenant: string,
  instance: string,
  secret: string,
  from: string,
  text: string
): Promise<void> {
  console.log(`[run]   -> [${from}] ${text}`);
  const result = await client.webhooks.ingest({
    tenant,
    channel: "http",
    instance,
    headers: { "x-http-channel-token": secret },
    body: { from, text, metadata: { source: "ai-system-variables/run.sh" } },
  });
  console.log(JSON.stringify(result));
}

async function main(): Promise<void> {
  const tenant = requireEnv("YOIZEN_TENANT");
  const email = requireEnv("YOIZEN_EMAIL");
  const password = requireEnv("YOIZEN_PASSWORD");
  const baseUrl = requireEnv("YOIZEN_BASE_URL");
  const hostHeader = process.env.YOIZEN_HOST_HEADER;

  const workflowName =
    process.env.SYSVARS_WORKFLOW_NAME ?? "ai-system-variables";
  // The apply engine derives a channel's externalId as `manifest:<name>`
  // (`channels-writer.ts`) — `manifest.yaml`'s channel name
  // (`ai-system-variables`) becomes the externalId
  // `manifest:ai-system-variables`.
  const instance =
    process.env.SYSVARS_HTTP_EXTERNAL_ID ?? "manifest:ai-system-variables";
  const sendDelayS = Number(process.env.SYSVARS_RUN_DELAY_S ?? "2");

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

  // ----- 1/3: verify workflow exists ------------------------------------------
  console.log(
    `[run] 1/3 verifying workflow '${workflowName}' exists (apply manifest.yaml first if this fails)...`
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

  // ----- 2/3: show the current policy (the system variables the run depends on) -
  console.log(
    "[run] 2/3 current system variables (these ARE the workflow's configuration):"
  );
  let companyName = "(missing!)";
  let escalationPriority = "(missing!)";
  let brandVoice = "(missing!)";
  let escalationVarId: string | undefined;
  for await (const variable of client.systemVariables.list({ pageSize: 100 })) {
    if (variable.name === "companyName") {
      companyName = String(variable.value);
    } else if (variable.name === "escalationPriority") {
      escalationPriority = String(variable.value);
      escalationVarId = variable.id;
    } else if (variable.name === "brandVoice") {
      brandVoice = String(variable.value);
    }
  }
  console.log(`[run]     companyName        = ${companyName}`);
  console.log(
    `[run]     escalationPriority = ${escalationPriority}   <- messages classified at THIS priority take the 🚨 arm`
  );
  console.log(`[run]     brandVoice         = ${brandVoice}`);

  // ----- 3/3: drive it ---------------------------------------------------------
  let secret: string | undefined;
  for await (const account of client.channels.listAccounts({
    channel: "http",
  })) {
    if (account.externalId === instance) {
      secret = account.appSecret ?? undefined;
      break;
    }
  }
  if (!secret) {
    console.error(
      `[run] could not resolve the '${instance}' instance token — apply manifest.yaml first`
    );
    process.exit(1);
  }

  const instanceUrl = `${baseUrl}/api/webhooks/http/${tenant}/${instance}`;
  console.log(
    `[run] 3/3 posting sample customer messages to the dedicated instance URL: ${instanceUrl}`
  );

  // The agent should classify this one at the escalation priority ("high" by
  // default) -> 🚨 escalation arm.
  await sendMessage(
    client,
    tenant,
    instance,
    secret,
    "furious-customer",
    "This is the THIRD time my internet goes down this week and nobody calls me back. Fix it TODAY or I am cancelling everything!"
  );
  await sleep(sendDelayS);

  // Calm question -> low/normal priority -> ✅ default arm.
  await sendMessage(
    client,
    tenant,
    instance,
    secret,
    "calm-customer",
    "Hi! Quick question — does my plan include roaming in Uruguay? No rush, thanks!"
  );

  console.log(
    "[run] sent — check Telegram. Both notifications are stamped with the companyName"
  );
  console.log("[run] variable, e.g.:");
  console.log(
    '[run]   "🚨 [Acme Telco] escalation — priority: high" + the brand-voiced summary'
  );
  console.log(
    '[run]   "✅ [Acme Telco] handled — priority: low"     + the brand-voiced summary'
  );
  console.log(
    "[run] The agentCall goes through a real LLM, so allow a few seconds per message."
  );
  console.log();
  console.log(
    "[run] ── try this: flip the routing policy LIVE (no workflow edit) ──────────────"
  );
  console.log("[run] Only messages classified 'urgent' will escalate after:");
  if (escalationVarId) {
    console.log(
      `[run]   curl -X PATCH '${baseUrl}/api/admin/system-variables/${escalationVarId}' \\`
    );
  } else {
    console.log(
      `[run]   curl -X PATCH '${baseUrl}/api/admin/system-variables/<id>' \\`
    );
  }
  console.log(
    `[run]     -H 'Host: ${hostHeader}' -H 'x-yoizen-tenant: ${tenant}' \\`
  );
  console.log(
    "[run]     -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \\"
  );
  console.log(`[run]     -d '{"value":"urgent"}'`);
  console.log(
    "[run] Same for the brand: PATCH companyName or brandVoice and re-run ./run.sh (or npm start)."
  );
  console.log(
    "[run] NOTE: workflow-service caches system variables per tenant for 5 minutes —"
  );
  console.log(
    "[run] allow up to 5 min before new executions pick up the change."
  );
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
