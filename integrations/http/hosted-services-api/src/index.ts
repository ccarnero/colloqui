/**
 * hosted-services-api sample driver — the RUN side that EXERCISES the
 * already-provisioned resources (provisioning itself is declarative now, via
 * `manifest.yaml` + `yoizen manifests apply`; see README.md).
 *
 * Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
 * once first to provision the hosted service, its dynamic route, the
 * workflow, and its dedicated HTTP channel instance. This script never
 * creates or modifies platform objects — it only:
 *   1. Confirms the sample's hosted service exists via
 *      `client.registry.services.list()`.
 *   2. Confirms the sample's dynamic route exists via
 *      `client.registry.routes.list()`.
 *   3. Waits for the gateway's dynamic-route cache to refresh, then invokes
 *      the route directly with a plain `fetch()` (that URL is served by the
 *      tenant's Knative service, not by the platform API, so it stays
 *      outside the SDK).
 *   4. If the optional workflow + HTTP channel instance exist, posts a test
 *      payload through `client.webhooks.ingest()` to drive it.
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

  const serviceName = process.env.HOSTED_SERVICE_NAME ?? "sample-echo";
  const routePrefix = process.env.HOSTED_ROUTE_PREFIX ?? "/samples/hosted-echo";
  const waitSeconds = Number(
    process.env.HOSTED_ROUTE_CACHE_WAIT_SECONDS ?? "16"
  );
  const workflowName =
    process.env.HOSTED_WORKFLOW_NAME ?? "hosted-service-telegram";
  // The apply engine derives a channel's externalId as `manifest:<name>`
  // (see manifest.yaml's channel `hosted-services-api`) — NOT the bare name
  // the deleted setup.ts used directly as its externalId.
  const httpExternalId =
    process.env.HOSTED_HTTP_EXTERNAL_ID ?? "manifest:hosted-services-api";
  const runText = process.env.RUN_TEXT ?? "hello hosted service workflow";

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
    `[run] verifying hosted service '${serviceName}' exists (apply manifest.yaml first if this fails)...`
  );
  let serviceId: string | undefined;
  for await (const service of client.registry.services.list()) {
    if (service.name === serviceName) {
      serviceId = service.id;
      break;
    }
  }
  if (!serviceId) {
    console.error(
      `[run] service '${serviceName}' not found — apply manifest.yaml first (see README.md)`
    );
    process.exit(1);
  }
  console.log(`[run] service found (id=${serviceId})`);

  console.log(`[run] checking route '${routePrefix}'...`);
  let routeId: string | undefined;
  for await (const route of client.registry.routes.list(serviceId)) {
    if (route.pathPrefix === routePrefix) {
      routeId = route.id;
      break;
    }
  }
  if (!routeId) {
    console.error(
      `[run] route '${routePrefix}' not found — apply manifest.yaml first (see README.md)`
    );
    process.exit(1);
  }
  console.log(`[run] route found (id=${routeId})`);

  if (waitSeconds !== 0) {
    console.log(
      `[run] waiting ${waitSeconds}s for gateway dynamic-route cache...`
    );
    await sleep(waitSeconds);
  }

  // The route's public URL is served by the tenant's Knative service (via
  // the gateway's dynamic-route proxy hook), not by a platform API endpoint
  // — it stays a plain fetch(), outside the SDK's resource surface.
  const invokeUrl = `${baseUrl}${routePrefix}/health`;
  console.log(`[run] calling ${invokeUrl}`);
  const invokeResp = await fetchWithHostHeader(invokeUrl, {
    headers: { "x-yoizen-tenant": tenant },
  });
  const invokeText = await invokeResp.text();
  try {
    console.log(JSON.stringify(JSON.parse(invokeText), null, 2));
  } catch {
    console.log(invokeText);
  }

  console.log(`[run] checking optional workflow '${workflowName}'...`);
  let workflowFound = false;
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === workflowName) {
      workflowFound = true;
      break;
    }
  }

  let appSecret: string | undefined;
  for await (const account of client.channels.listAccounts({
    channel: "http",
  })) {
    if (account.externalId === httpExternalId) {
      appSecret = account.appSecret ?? undefined;
      break;
    }
  }

  if (workflowFound && appSecret) {
    const messageText = `${runText} [${Math.floor(Date.now() / 1000)}]`;
    console.log(
      `[run] driving workflow via ${baseUrl}/api/webhooks/http/${tenant}/${httpExternalId}`
    );
    const result = await client.webhooks.ingest({
      tenant,
      channel: "http",
      instance: httpExternalId,
      headers: { "x-http-channel-token": appSecret },
      body: { from: "hosted-services-api/run.sh", text: messageText },
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(
      "[run] sent — check Telegram for a message prefixed 'HOSTED SERVICE SAMPLE'."
    );
  } else {
    console.log(
      "[run] workflow not found — apply manifest.yaml --secrets-from-env first (see README.md)"
    );
  }

  console.log(
    "[run] done — if direct invoke returned 502, inspect the Knative Service readiness and image /health support."
  );
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
