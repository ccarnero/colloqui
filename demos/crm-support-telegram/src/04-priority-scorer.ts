/**
 * 04-priority-scorer -- builds the priority-scorer hosted-service image and
 * registers it as a Knative-backed service via the registry resource
 * (client.registry.services) for the crm-support-telegram demo, per the
 * sdk/samples/hosted-services-api conventions -- PORT is Knative-reserved,
 * never set it in envVars.
 *
 * Adapted from demos/crm-support-telegram/src/0{1,2,3}-*.ts (stage
 * structure, lib helpers, client bootstrap with the Host-header fetch
 * wrapper) and sdk/samples/hosted-services-api/src/setup.ts plus
 * sdk/samples/ai-call-center-supervisor/src/setup.ts (registry.services
 * create-or-update-by-name, the waitForCrmReady poll of the Knative Ready
 * condition). Copied and adapted, NOT imported across trees, see
 * demos/README.md.
 *
 * Image build note (new territory for this demo -- no prior sample builds a
 * custom image): the priority-scorer package's own Dockerfile builds the SDK
 * from source inside a build stage, because the repo-root dockerignore
 * excludes build-output directories everywhere, and the docker build shells
 * out from the repo root so the local SDK path dependency resolves. The
 * image is tagged for the dev-local registry host that
 * bootstrap-orbstack-osx.sh configured Knative to skip tag-to-digest
 * resolution for, so the locally-built image (OrbStack shares its Docker
 * daemon with the cluster) deploys without a push -- the same convention
 * rebuild-redeploy.sh uses for platform services.
 *
 * In-cluster addressing note (new territory, verified live against the dev
 * cluster 2026-07-14, see "Findings T05"): registry-service's service-name
 * and namespace-name helpers are fully deterministic, so this script
 * precomputes the service's own in-cluster URL and the in-cluster gateway
 * URL and passes both as envVars at registration time -- the running
 * container needs the gateway URL to call connectors.invoke() and its own
 * URL to build the tickets-to-webhooks-invoke callback.
 *
 * IDEMPOTENT: the service is created-or-updated by name; envVars, including
 * the resolved HubSpot connector/endpoint ids, are reconciled on every run.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@yoizen/platform-sdk";
import type { Connector } from "@yoizen/platform-sdk/connectors";
import type {
  RegisteredService,
  RegisterServiceInput,
  UpdateServiceInput,
} from "@yoizen/platform-sdk/registry";
import { fail } from "./lib/fail.js";
import { log, step, warn } from "./lib/logging.js";
import { requireEnv } from "./lib/require-env.js";
import { runStage } from "./lib/run-stage.js";

// ----- Configuration ---------------------------------------------------------
const SERVICE_NAME = process.env.SCORER_SERVICE_NAME ?? "priority-scorer";
const SERVICE_PORT = Number(process.env.SCORER_SERVICE_PORT ?? "8080");
const MIN_SCALE = Number(process.env.SCORER_MIN_SCALE ?? "0");
const MAX_SCALE = Number(process.env.SCORER_MAX_SCALE ?? "2");
const CONCURRENCY_TARGET = Number(
  process.env.SCORER_CONCURRENCY_TARGET ?? "10"
);
const PLATFORM_ENVIRONMENT = process.env.PLATFORM_ENVIRONMENT ?? "dev";
const IMAGE_TAG = process.env.SCORER_IMAGE_TAG ?? "local";
const IMAGE_REF = `dev.local/priority-scorer:${IMAGE_TAG}`;
const READY_TIMEOUT_SECONDS = Number(
  process.env.SCORER_READY_TIMEOUT_SECONDS ?? "120"
);
const HUBSPOT_CONNECTOR_NAME = "demo-hubspot";

const HUBSPOT_DEALS_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/associations/contacts/deals/batch/read",
};
const HUBSPOT_TICKETS_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/associations/contacts/tickets/batch/read",
};
const HUBSPOT_CREATE_TICKET_ENDPOINT = {
  method: "POST",
  path: "/crm/v3/objects/tickets",
};

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// `demos/crm-support-telegram/priority-scorer` and `.../` (the repo root, 2
// levels up from `demos/crm-support-telegram`) are computed relative to this
// file so the docker build works regardless of the caller's cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const demoDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(demoDir, "../..");
const dockerfilePath = path.join(
  "demos/crm-support-telegram/priority-scorer/Dockerfile"
);

export interface PriorityScorerResult {
  serviceId: string;
  serviceName: string;
  knativeName: string;
  namespace: string;
  ready: boolean;
  smokeCheckStatus: number;
  smokeCheckBody: unknown;
}

export async function main(): Promise<PriorityScorerResult> {
  // ----- Stage 1: preflight -------------------------------------------------
  const { tenant, email, password, baseUrl, hostHeader } = await runStage(
    "preflight",
    async () => {
      const tenant = requireEnv("YOIZEN_TENANT");
      const email = requireEnv("YOIZEN_EMAIL");
      const password = requireEnv("YOIZEN_PASSWORD");
      const baseUrl = requireEnv("YOIZEN_BASE_URL");
      const hostHeader = process.env.YOIZEN_HOST_HEADER;
      log(
        `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  service=${SERVICE_NAME}  image=${IMAGE_REF}`
      );
      return { tenant, email, password, baseUrl, hostHeader };
    }
  );

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

  // ----- Stage 2: resolve the demo-hubspot connector + endpoint ids --------
  const {
    connectorId,
    dealsEndpointId,
    ticketsEndpointId,
    createTicketEndpointId,
  } = await runStage(
    `resolve connector '${HUBSPOT_CONNECTOR_NAME}' + endpoints`,
    async () => {
      const connectors: Connector[] = [];
      for await (const connector of client.connectors.list({
        context: "external",
      })) {
        connectors.push(connector);
      }
      const connector = connectors.find(
        (c) => c.name === HUBSPOT_CONNECTOR_NAME
      );
      if (!connector) {
        fail(
          `connector '${HUBSPOT_CONNECTOR_NAME}' not found — run 02-hubspot-connector.sh first`
        );
      }

      const findEndpoint = (target: { method: string; path: string }) =>
        connector.endpoints.find(
          (e) => e.method === target.method && e.path === target.path
        );

      const deals = findEndpoint(HUBSPOT_DEALS_ENDPOINT);
      const tickets = findEndpoint(HUBSPOT_TICKETS_ENDPOINT);
      const createTicket = findEndpoint(HUBSPOT_CREATE_TICKET_ENDPOINT);
      if (!deals || !tickets || !createTicket) {
        fail(
          `connector '${HUBSPOT_CONNECTOR_NAME}' is missing one of the required endpoints — run 02-hubspot-connector.sh first`
        );
      }

      log(
        `connector=${connector.id}  deals-endpoint=${deals.id}  tickets-endpoint=${tickets.id}  create-ticket-endpoint=${createTicket.id}`
      );
      return {
        connectorId: connector.id,
        dealsEndpointId: deals.id,
        ticketsEndpointId: tickets.id,
        createTicketEndpointId: createTicket.id,
      };
    }
  );

  // ----- Stage 3: build the hosted-service image ----------------------------
  await runStage(`build image '${IMAGE_REF}'`, async () => {
    log(`docker build -f ${dockerfilePath} -t ${IMAGE_REF} ${repoRoot}`);
    try {
      execFileSync(
        "docker",
        ["build", "-f", dockerfilePath, "-t", IMAGE_REF, repoRoot],
        { cwd: repoRoot, stdio: "inherit" }
      );
    } catch (e) {
      fail(`docker build FAILED: ${messageOf(e)}`);
    }
    log(`image built: ${IMAGE_REF}`);
  });

  // ----- Stage 4: precompute in-cluster addressing --------------------------
  // Deterministic per registry-service (services.service.ts
  // `knativeServiceName`/`namespaceName`) — verified live 2026-07-14, see
  // "Findings (T05)".
  const knativeName = `${SERVICE_NAME}-${tenant}`;
  const namespace = `${tenant}-${PLATFORM_ENVIRONMENT}-ns`;
  const selfInternalBaseUrl = `http://${knativeName}.${namespace}.svc.cluster.local`;
  const internalGatewayBaseUrl = `http://api-gateway.platform-services-${PLATFORM_ENVIRONMENT}.svc.cluster.local`;
  log(
    `self-internal-url=${selfInternalBaseUrl}  gateway-internal-url=${internalGatewayBaseUrl}`
  );

  // ----- Stage 5: ensure the registered Knative service ---------------------
  const serviceId = await runStage(
    `ensure registered service '${SERVICE_NAME}'`,
    async () => {
      const envVars: Record<string, string> = {
        YOIZEN_TENANT: tenant,
        YOIZEN_EMAIL: email,
        YOIZEN_PASSWORD: password,
        YOIZEN_BASE_URL: internalGatewayBaseUrl,
        HUBSPOT_CONNECTOR_ID: connectorId,
        HUBSPOT_DEALS_ENDPOINT_ID: dealsEndpointId,
        HUBSPOT_TICKETS_ENDPOINT_ID: ticketsEndpointId,
        HUBSPOT_CREATE_TICKET_ENDPOINT_ID: createTicketEndpointId,
        SELF_INTERNAL_BASE_URL: selfInternalBaseUrl,
      };

      const all: RegisteredService[] = [];
      for await (const service of client.registry.services.list()) {
        all.push(service);
      }
      const matching = all.filter((s) => s.name === SERVICE_NAME);

      if (matching.length > 1) {
        warn(
          `duplicate registered services named '${SERVICE_NAME}' (${matching.length} found) — auto-healing, keeping first`
        );
        for (const stale of matching.slice(1)) {
          log(`  deleting duplicate service ${stale.id}`);
          await client.registry.services
            .remove(stale.id)
            .catch(() => undefined);
        }
      }

      const existing = matching[0];
      if (existing) {
        const updateBody: UpdateServiceInput = {
          image: IMAGE_REF,
          port: SERVICE_PORT,
          minScale: MIN_SCALE,
          maxScale: MAX_SCALE,
          concurrencyTarget: CONCURRENCY_TARGET,
          envVars,
        };
        const updated = await client.registry.services
          .update(existing.id, updateBody)
          .catch((e) => {
            fail(`service update FAILED: ${messageOf(e)}`);
          });
        log(`reuse  '${SERVICE_NAME}' — updated (id=${updated.id})`);
        return updated.id;
      }

      const createBody: RegisterServiceInput = {
        name: SERVICE_NAME,
        image: IMAGE_REF,
        port: SERVICE_PORT,
        minScale: MIN_SCALE,
        maxScale: MAX_SCALE,
        concurrencyTarget: CONCURRENCY_TARGET,
        envVars,
      };
      const created = await client.registry.services
        .create(createBody)
        .catch((e) => {
          fail(`service create FAILED: ${messageOf(e)}`);
        });
      log(`create '${SERVICE_NAME}' -> id=${created.id}`);
      return created.id;
    }
  );

  // ----- Stage 6: wait for Knative Ready -------------------------------------
  const ready = await runStage("wait for Knative Ready", async () => {
    const deadline = Date.now() + READY_TIMEOUT_SECONDS * 1000;
    let lastReady: string | undefined;
    while (true) {
      const detail = await client.registry.services.get(serviceId);
      const conditions =
        (detail.knativeStatus?.conditions as
          | Array<{ type?: string; status?: string }>
          | undefined) ?? [];
      lastReady = conditions.find((c) => c.type === "Ready")?.status;
      if (lastReady === "True") {
        log(`service '${SERVICE_NAME}' is Ready`);
        return true;
      }
      if (Date.now() >= deadline) {
        fail(
          `service '${SERVICE_NAME}' not Ready after ${READY_TIMEOUT_SECONDS}s (last Ready=${lastReady ?? "unknown"})`
        );
      }
      await sleep(3);
    }
  });

  // ----- Stage 7: direct-invoke /score smoke check ---------------------------
  // Direct call to the Knative service's in-cluster URL (not through the SDK
  // or a gateway route — verified live 2026-07-14 that OrbStack resolves
  // `*.svc.cluster.local` directly from the host, see "Findings (T05)").
  const { smokeCheckStatus, smokeCheckBody } = await runStage(
    "smoke check: direct-invoke POST /score",
    async () => {
      const url = `${selfInternalBaseUrl}/score`;
      log(`POST ${url}`);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: "smoke-check-probe" }),
      });
      const body = await resp.json().catch(() => undefined);
      log(`smoke check -> HTTP ${resp.status} body=${JSON.stringify(body)}`);
      if (resp.status !== 200) {
        fail(`smoke check FAILED: expected HTTP 200, got ${resp.status}`);
      }
      if (
        !body ||
        typeof (body as Record<string, unknown>).score !== "number" ||
        typeof (body as Record<string, unknown>).tier !== "string" ||
        !Array.isArray((body as Record<string, unknown>).reasons)
      ) {
        fail(
          `smoke check FAILED: /score response missing score/tier/reasons: ${JSON.stringify(body)}`
        );
      }
      return { smokeCheckStatus: resp.status, smokeCheckBody: body };
    }
  );

  return {
    serviceId,
    serviceName: SERVICE_NAME,
    knativeName,
    namespace,
    ready,
    smokeCheckStatus,
    smokeCheckBody,
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
      log(`service_id=${result.serviceId}`);
      log(`service_slug=${result.serviceName}`);
      log(`knative_name=${result.knativeName}`);
      log(`namespace=${result.namespace}`);
      log(`knative_ready=${result.ready}`);
      log(`smoke_check_status=${result.smokeCheckStatus}`);
      log(`smoke_check_body=${JSON.stringify(result.smokeCheckBody)}`);
    })
    .catch((e) => {
      fail(`04-priority-scorer failed: ${e instanceof Error ? e.message : e}`);
    });
}
