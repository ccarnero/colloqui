/**
 * ai-call-center-supervisor sample driver — SDK-powered replacement for the
 * old curl+jq `run.sh` body (see sdk/GROWTH-PLAN.md P3.1, following the
 * `http-bridge` reference pattern).
 *
 * Prerequisite: run ./setup.sh once first. This script never creates or
 * modifies platform objects — it only:
 *   1. Logs in and lists workflows via `client.workflows.list()` to confirm
 *      the sample's workflow exists.
 *   2. Lists `channel: "http"` accounts via `client.channels.listAccounts()`
 *      to resolve the dedicated instance's `appSecret`.
 *   3. Posts two contrasting customer messages through
 *      `client.webhooks.ingest()` and tells you what to expect on Telegram.
 *
 * All configuration comes from environment variables, matching the names
 * `../lib/resolve-env.sh` exports and `.env.example` documents — this file is
 * invoked by `run.sh` after that resolution has already happened.
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

  const workflowName =
    process.env.SUPERVISOR_WORKFLOW_NAME ?? "ai-call-center-supervisor";
  const agentName = process.env.AI_AGENT_NAME ?? "ai-sample-supervisor";
  const instanceExternalId =
    process.env.SUPERVISOR_HTTP_EXTERNAL_ID ?? "ai-call-center-supervisor";
  const pauseSeconds = Number(process.env.SUPERVISOR_RUN_PAUSE_SECONDS ?? "3");
  const angryText =
    process.env.SUPERVISOR_RUN_TEXT_ANGRY ??
    "third time my bill is wrong, I want a $200 refund or I cancel";
  const calmText =
    process.env.SUPERVISOR_RUN_TEXT_CALM ?? "how do I update my email address?";

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
    `[run] 1/3 verifying workflow '${workflowName}' exists (run ./setup.sh first if this fails)...`
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

  async function postMessage(from: string, text: string): Promise<void> {
    const result = await client.webhooks.ingest({
      tenant,
      channel: "http",
      instance: instanceExternalId,
      headers: { "x-http-channel-token": appSecret! },
      body: {
        from,
        text,
        metadata: { source: "ai-call-center-supervisor/run.sh" },
      },
    });
    console.log(JSON.stringify(result, null, 2));
  }

  console.log(
    "[run] 2/3 posting the ANGRY message (expect a \u{1F6A8} SUPERVISOR ESCALATION on Telegram)"
  );
  await postMessage("cust-1001", angryText);

  console.log(`[run]     pausing ${pauseSeconds}s between messages...`);
  await sleep(pauseSeconds);

  console.log(
    "[run] 3/3 posting the CALM message (expect a \u{2705} AUTO-RESOLVED summary on Telegram)"
  );
  await postMessage("cust-2002", calmText);

  console.log();
  console.log("[run] sent both. What happens now, per message:");
  console.log(
    "[run]   lookupCustomer (serviceCall -> sample-crm echo)  ->  buildTriageInput (jsFunction)"
  );
  console.log(
    `[run]   ->  triage (agentCall '${agentName}' agent)  ->  decide (jsFunction)  ->  route (conditional)`
  );
  console.log(
    "[run] The LLM triage takes a few seconds — then the bot DMs the supervisor chat:"
  );
  console.log(
    "[run]   \u{1F6A8} SUPERVISOR ESCALATION ... for the angry $200-refund message"
  );
  console.log(
    "[run]   \u{2705} AUTO-RESOLVED ...        for the calm email-address question"
  );
  console.log(
    "[run] If nothing arrives, check the workflow executions in the admin console and"
  );
  console.log(
    "[run] that the Knative 'sample-crm' service can cold-start (first call may be slow)."
  );
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
