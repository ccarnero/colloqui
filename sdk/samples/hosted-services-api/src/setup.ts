/**
 * hosted-services-api sample provisioning — SDK-powered replacement for the
 * old curl+jq `setup.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * Registers a tenant-scoped Knative-backed hosted service through the
 * gateway registry API, creates a dynamic route for it, and (optionally)
 * wires a workflow that invokes the hosted service and notifies Telegram.
 * All of this goes through `@yoizen/platform-sdk`'s `registry`, `channels`,
 * and `workflows` resources.
 *
 * API surface verified in code:
 *   - services/api-gateway/src/modules/registry/registry.controller.ts
 *       /api/registry/services, /api/registry/services/:id/routes
 *   - services/registry-service/src/modules/services/services.service.ts
 *       creates/updates Knative Service resources and stores service metadata
 *   - services/registry-service/src/modules/routes/routes.service.ts
 *       creates pathPrefix routes and route discovery rows
 *   - services/api-gateway/src/hooks/proxy.hook.ts
 *       proxies non-platform paths to <knativeName>.<namespace>.svc.cluster.local
 *
 * Same env vars, defaults, and idempotency/dedup/RECREATE semantics as the
 * bash version this replaces. Invoked by `setup.sh` after
 * `../lib/resolve-env.sh` has resolved the environment.
 */
import { createClient } from "@yoizen/platform-sdk";
import type { ChannelAccount } from "@yoizen/platform-sdk/channels";
import type {
  RegisteredService,
  RegisterServiceInput,
  RouteMethod,
  ServiceRoute,
  UpdateServiceInput,
} from "@yoizen/platform-sdk/registry";
import type { Workflow } from "@yoizen/platform-sdk/workflows";

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

// ----- Configuration (override via env) -------------------------------------
// YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL,
// YOIZEN_PASSWORD are all exported by resolve-env.sh (see ../setup.sh). Only
// script-specific vars are read here.

const SERVICE_NAME = process.env.HOSTED_SERVICE_NAME ?? "sample-echo";
const SERVICE_IMAGE =
  process.env.HOSTED_SERVICE_IMAGE ?? "ealen/echo-server:latest";
const SERVICE_PORT = Number(process.env.HOSTED_SERVICE_PORT ?? "8080");
const MIN_SCALE = Number(process.env.HOSTED_MIN_SCALE ?? "0");
const MAX_SCALE = Number(process.env.HOSTED_MAX_SCALE ?? "2");
const CONCURRENCY_TARGET = Number(
  process.env.HOSTED_CONCURRENCY_TARGET ?? "25"
);
const ROUTE_PREFIX = process.env.HOSTED_ROUTE_PREFIX ?? "/samples/hosted-echo";
const ROUTE_PUBLIC = process.env.HOSTED_ROUTE_PUBLIC ?? "true";
const ROUTE_STRIP_PREFIX = process.env.HOSTED_ROUTE_STRIP_PREFIX ?? "true";
const ROUTE_METHODS = process.env.HOSTED_ROUTE_METHODS ?? "GET,POST";
let WORKFLOW_ENABLED = process.env.HOSTED_WORKFLOW_ENABLED ?? "1";
const WORKFLOW_NAME =
  process.env.HOSTED_WORKFLOW_NAME ?? "hosted-service-telegram";
const APPLICATION = process.env.HOSTED_WORKFLOW_APPLICATION ?? "samples";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
let TG_ACCOUNT_ID = process.env.TG_ACCOUNT_ID ?? "";
const HTTP_EXTERNAL_ID =
  process.env.HOSTED_HTTP_EXTERNAL_ID ?? "hosted-services-api";
const HTTP_ACCOUNT_NAME =
  process.env.HOSTED_HTTP_ACCOUNT_NAME ?? "Hosted Services API";
const HOSTED_WORKFLOW_PIN = process.env.HOSTED_WORKFLOW_PIN ?? "1";
const RECREATE = process.env.RECREATE ?? "0";

// The workflow's summarize step. Honors the inbound request text and the
// invokeHosted serviceCall result, mirroring the old bash SUMMARY_CODE
// heredoc byte-for-byte in behavior.
const SUMMARY_CODE = `(ctx) => {
  var inbound = (ctx.request && ctx.request.text) || "";
  var call = ctx.results.invokeHosted || {};
  var data = call.data || {};
  var path = data.path || data.url || data.originalUrl || "/anything";
  var body = data.body || data.data || {};
  var workflowName = body.workflowName || "hosted-service-telegram";
  var serviceName = body.serviceName || "sample-echo";
  var marker = "HOSTED SERVICE SAMPLE";
  return {
    text:
      marker + "\\n" +
      "Workflow: " + workflowName + "\\n" +
      "Inbound: " + (inbound || "-") + "\\n" +
      "Hosted service: " + serviceName + "\\n" +
      "Status: " + (call.status || "-") + "\\n" +
      "Echo path: " + path + "\\n" +
      "Echo body: " + JSON.stringify(body)
  };
}`;

function parseBool(value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "y":
      return true;
    case "0":
    case "false":
    case "no":
    case "n":
      return false;
    default:
      return fail(`invalid boolean '${value}'`);
  }
}

function parseMethods(value: string): RouteMethod[] {
  return value
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter((m) => m.length > 0) as RouteMethod[];
}

function workflowEnabled(): boolean {
  return parseBool(WORKFLOW_ENABLED);
}

const tenant = requireEnv("YOIZEN_TENANT");
const email = requireEnv("YOIZEN_EMAIL");
const password = requireEnv("YOIZEN_PASSWORD");
const baseUrl = requireEnv("YOIZEN_BASE_URL");
const hostHeader = process.env.YOIZEN_HOST_HEADER;

// The gateway's dev ingress routes by Host header (see ../lib/resolve-env.sh);
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

let serviceId = "";
let routeId = "";
let workflowId = "";
let httpAccountId = "";
let httpAppSecret = "";

// ----- Stage 0/5: preflight ---------------------------------------------------
function stagePreflight(): void {
  step("0/5 preflight");
  if (!ROUTE_PREFIX.startsWith("/")) {
    fail("HOSTED_ROUTE_PREFIX must start with /");
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(SERVICE_NAME)) {
    fail(
      "HOSTED_SERVICE_NAME must be lowercase alphanumeric with optional hyphens"
    );
  }
  if (workflowEnabled() && !TELEGRAM_CHAT_ID) {
    warn(
      "TELEGRAM_CHAT_ID is not set — hosted workflow/Telegram notification will be skipped."
    );
    WORKFLOW_ENABLED = "0";
  }
  log(
    `service=${SERVICE_NAME} image=${SERVICE_IMAGE}:${SERVICE_PORT} route=${ROUTE_PREFIX} workflow=${workflowEnabled()} recreate=${RECREATE}`
  );
}

// ----- Registry service body builders ----------------------------------------
function serviceBody(): RegisterServiceInput {
  return {
    name: SERVICE_NAME,
    image: SERVICE_IMAGE,
    port: SERVICE_PORT,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    concurrencyTarget: CONCURRENCY_TARGET,
    envVars: { YOIZEN_SAMPLE: "hosted-services-api" },
  };
}

function serviceUpdateBody(): UpdateServiceInput {
  const { name: _name, ...rest } = serviceBody();
  return rest;
}

// ----- Stage 2/5: ensure hosted service ---------------------------------------
async function stageEnsureService(): Promise<void> {
  step(`2/5 ensure hosted service '${SERVICE_NAME}'`);

  let found: RegisteredService | undefined;
  for await (const service of client.registry.services.list()) {
    if (service.name === SERVICE_NAME) {
      found = service;
      break;
    }
  }
  serviceId = found?.id ?? "";

  if (serviceId && RECREATE === "1") {
    log(`RECREATE=1 — deleting service ${serviceId}`);
    await client.registry.services.remove(serviceId).catch(() => undefined);
    serviceId = "";
  }

  if (serviceId) {
    const updated = await client.registry.services
      .update(serviceId, serviceUpdateBody())
      .catch((e) => {
        fail(`Service update failed: ${e instanceof Error ? e.message : e}`);
      });
    if (!updated?.id || updated.id !== serviceId) {
      fail(`Service update failed: ${JSON.stringify(updated)}`);
    }
    log(`updated existing service ${serviceId}`);
    return;
  }

  const created = await client.registry.services
    .create(serviceBody())
    .catch((e) => {
      fail(`Service creation failed: ${e instanceof Error ? e.message : e}`);
    });
  if (!created?.id) {
    fail(`Service creation failed: ${JSON.stringify(created)}`);
  }
  serviceId = created.id;
  log(`created service ${serviceId}`);
}

// ----- Stage 3/5: ensure route -------------------------------------------------
async function stageEnsureRoute(): Promise<void> {
  step(`3/5 ensure route '${ROUTE_PREFIX}'`);

  const routes: ServiceRoute[] = [];
  for await (const route of client.registry.routes.list(serviceId)) {
    routes.push(route);
  }

  const desiredMethods = [...parseMethods(ROUTE_METHODS)].sort();
  const desiredPublic = parseBool(ROUTE_PUBLIC);
  const desiredStripPrefix = parseBool(ROUTE_STRIP_PREFIX);

  const matching = routes.find(
    (r) =>
      r.pathPrefix === ROUTE_PREFIX &&
      r.isPublic === desiredPublic &&
      r.stripPrefix === desiredStripPrefix &&
      JSON.stringify([...r.methods].sort()) === JSON.stringify(desiredMethods)
  );

  const stale = routes.filter(
    (r) => r.pathPrefix === ROUTE_PREFIX && r.id !== matching?.id
  );
  for (const route of stale) {
    log(`removing stale route ${route.id}`);
    await client.registry.routes
      .remove(serviceId, route.id)
      .catch(() => undefined);
  }

  if (matching) {
    routeId = matching.id;
    log(`reusing route ${routeId}`);
    return;
  }

  const created = await client.registry.routes
    .create(serviceId, {
      pathPrefix: ROUTE_PREFIX,
      methods: desiredMethods,
      isPublic: desiredPublic,
      stripPrefix: desiredStripPrefix,
    })
    .catch((e) => {
      fail(`Route creation failed: ${e instanceof Error ? e.message : e}`);
    });
  if (!created?.id) {
    fail(`Route creation failed: ${JSON.stringify(created)}`);
  }
  routeId = created.id;
  log(`created route ${routeId}`);
}

// ensureHttpAccount — resolve (or create) the sample's dedicated HTTP channel
// instance, identified by externalId. Captures httpAccountId + httpAppSecret
// (the gateway returns appSecret in the list, plaintext). Deduplicates on
// every run.
async function ensureHttpAccount(): Promise<void> {
  const accounts: ChannelAccount[] = [];
  for await (const account of client.channels.listAccounts({
    channel: "http",
  })) {
    accounts.push(account);
  }

  // Collect ALL exact-externalId-matching active accounts, newest first
  // (the API returns them oldest-first, so reverse).
  const matching = accounts
    .filter((a) => a.externalId === HTTP_EXTERNAL_ID && a.isActive)
    .reverse();

  const keep = matching[0];
  const stale = matching.slice(1);

  // Always dedup: keep newest, delete the rest on every run.
  for (const account of stale) {
    log(`removing duplicate HTTP instance ${account.id}`);
    await client.channels.removeAccount(account.id).catch(() => undefined);
  }

  // Reuse the survivor unless RECREATE=1.
  if (keep && RECREATE !== "1") {
    httpAccountId = keep.id;
    httpAppSecret = keep.appSecret ?? "";
    log(
      `reusing HTTP instance ${httpAccountId} (externalId=${HTTP_EXTERNAL_ID})`
    );
    return;
  }

  // RECREATE=1 or no existing account: delete survivor if any, then create
  // fresh.
  if (keep) {
    log(`RECREATE=1 — removing HTTP instance ${keep.id}`);
    await client.channels.removeAccount(keep.id).catch(() => undefined);
  }

  const created = await client.channels
    .createAccount({
      channel: "http",
      provider: "http",
      name: HTTP_ACCOUNT_NAME,
      externalId: HTTP_EXTERNAL_ID,
      accessToken: "http-ingest",
      isActive: true,
    })
    .catch((e) => {
      fail(
        `HTTP instance creation failed: ${e instanceof Error ? e.message : e}`
      );
    });

  if (!created?.id) {
    fail(`HTTP instance creation failed: ${JSON.stringify(created)}`);
  }
  httpAccountId = created.id;
  httpAppSecret = created.appSecret ?? "";
  log(
    `created HTTP instance ${httpAccountId} (externalId=${HTTP_EXTERNAL_ID})`
  );
}

// buildWorkflowBody — assemble the workflow definition with resolved ids.
function buildWorkflowBody() {
  return {
    name: WORKFLOW_NAME,
    application: APPLICATION,
    actions: [
      {
        name: "invokeHosted",
        activity: "serviceCall",
        args: {
          serviceId,
          serviceSlug: SERVICE_NAME,
          method: "POST",
          path: "/anything",
          data: {
            source: "hosted-services-api",
            marker: "HOSTED SERVICE SAMPLE",
            workflowName: WORKFLOW_NAME,
            serviceName: SERVICE_NAME,
            inbound: "{{request.text}}",
          },
        },
      },
      {
        name: "summarize",
        activity: "jsFunction",
        args: { code: SUMMARY_CODE },
      },
      {
        name: "notify",
        activity: "channelSend",
        args: {
          accountId: TG_ACCOUNT_ID,
          channel: "telegram",
          provider: "telegram",
          to: TELEGRAM_CHAT_ID,
          type: "text",
          text: "{{results.summarize.text}}",
        },
      },
    ],
    trigger: {
      type: "message_received",
      mode: "shared" as const,
      config: {
        channels: ["http"],
        providers: ["http"],
        ...(HOSTED_WORKFLOW_PIN === "1" ? { accountIds: [httpAccountId] } : {}),
      },
    },
  };
}

// ----- Stage 4/5: ensure workflow (optional) ----------------------------------
async function stageEnsureWorkflow(): Promise<void> {
  if (!workflowEnabled()) {
    step("4/5 skip workflow (HOSTED_WORKFLOW_ENABLED=0)");
    return;
  }

  step(`4/5 ensure workflow '${WORKFLOW_NAME}'`);

  if (!TG_ACCOUNT_ID) {
    const tgAccounts: ChannelAccount[] = [];
    for await (const account of client.channels.listAccounts({
      channel: "telegram",
    })) {
      tgAccounts.push(account);
    }
    TG_ACCOUNT_ID = tgAccounts.find((a) => a.isActive)?.id ?? "";
  }
  if (!TG_ACCOUNT_ID) {
    err("no active Telegram channel account found.");
    err(
      "Provision one first:  (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)"
    );
    err("or pin one with TG_ACCOUNT_ID=<id>.");
    process.exit(1);
  }
  log(`telegram account=${TG_ACCOUNT_ID}`);

  await ensureHttpAccount();

  const allWorkflows: Workflow[] = [];
  for await (const workflow of client.workflows.list()) {
    if (workflow.name === WORKFLOW_NAME) {
      allWorkflows.push(workflow);
    }
  }
  // API returns oldest-first; reverse so newest is first.
  const matching = allWorkflows.reverse();
  const keep = matching[0];
  const stale = matching.slice(1);

  // Always dedup: delete extras on every run, not just on recreate.
  for (const workflow of stale) {
    log(`removing duplicate workflow ${workflow.id}`);
    await client.workflows.remove(workflow.id).catch(() => undefined);
  }

  const body = buildWorkflowBody();

  if (keep && RECREATE !== "1") {
    workflowId = keep.id;
    const updated = await client.workflows
      .update(workflowId, body)
      .catch((e) => {
        fail(`Workflow update failed: ${e instanceof Error ? e.message : e}`);
      });
    if (!updated?.id || updated.id !== workflowId) {
      fail(`Workflow update failed: ${JSON.stringify(updated)}`);
    }
    log(`updated existing workflow ${workflowId}`);
    return;
  }

  if (keep) {
    log(`RECREATE=1 — deleting workflow ${keep.id}`);
    await client.workflows.remove(keep.id).catch(() => undefined);
  }

  const created = await client.workflows.create(body).catch((e) => {
    fail(`Workflow creation failed: ${e instanceof Error ? e.message : e}`);
  });
  if (!created?.id) {
    fail(`Workflow creation failed: ${JSON.stringify(created)}`);
  }
  workflowId = created.id;
  log(`created workflow id=${workflowId}`);
}

// ----- Stage 5/5: summary -------------------------------------------------------
function stageSummary(): void {
  step("5/5 summary");
  const invokeUrl = `${baseUrl}${ROUTE_PREFIX}`;
  log(`service id : ${serviceId}`);
  log(`route id   : ${routeId}`);
  log(`invoke URL : ${invokeUrl}`);
  if (workflowId) {
    const ingestUrl = `${baseUrl}/api/webhooks/http/${tenant}/${HTTP_EXTERNAL_ID}`;
    log(`workflow id: ${workflowId}`);
    log(`http input : ${ingestUrl}`);
    log(
      `telegram  : chat ${TELEGRAM_CHAT_ID} (message prefix: HOSTED SERVICE SAMPLE)`
    );
  }
  warn(
    "Gateway dynamic route cache refreshes every ~15s; wait briefly before first invoke."
  );
  console.log();
  log("Try it:");
  log(
    `  curl -s '${invokeUrl}/health' -H 'Host: ${hostHeader ?? ""}' -H 'x-yoizen-tenant: ${tenant}' | jq .`
  );
  log(
    `  curl -s '${invokeUrl}/anything?source=sample' -H 'Host: ${hostHeader ?? ""}' -H 'x-yoizen-tenant: ${tenant}' | jq .`
  );
  if (httpAppSecret) {
    log(
      `  curl -s -X POST '${baseUrl}/api/webhooks/http/${tenant}/${HTTP_EXTERNAL_ID}' \\`
    );
    log(
      `    -H 'content-type: application/json' -H 'x-http-channel-token: ${httpAppSecret}' \\`
    );
    log(`    -d '{"text":"hello hosted service"}' | jq .`);
  }
}

async function main(): Promise<void> {
  stagePreflight();
  // Login itself is handled transparently by createClient()/the SDK session
  // on first request — no explicit login stage needed here.
  await stageEnsureService();
  await stageEnsureRoute();
  await stageEnsureWorkflow();
  stageSummary();
}

main().catch((e) => {
  err(`failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
