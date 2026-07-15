/**
 * 02-hubspot-connector — provisions the `demo-hubspot` connector (HubSpot CRM
 * REST API) for the crm-support-telegram demo: contact search/create, deal
 * and ticket associations by contact, and ticket creation.
 *
 * Adapted from `integrations/http/http-connectors/src/setup.ts` (connector +
 * endpoint + cache-strategy upsert via `@yoizen/platform-sdk`'s `connectors`
 * resource) and `demos/crm-support-telegram/src/01-telegram-channel.ts`
 * (stage structure, lib helpers, client bootstrap with the Host-header fetch
 * wrapper). Copied and adapted, NOT imported across trees (`demos/README.md`).
 *
 * Auth: bearer token from `HUBSPOT_SERVICE_KEY` (HubSpot account Service Key,
 * public beta since 2026-02-10 — a legacy private-app token is an equally
 * free, interchangeable Bearer-token fallback; see SPEC "User decisions" #3).
 * The token is read from the environment at provisioning time and sent to
 * the platform ONLY as the connector's `authConfig.bearerToken` — it is never
 * written to disk or committed; the platform then injects it as the
 * `Authorization: Bearer …` header on every outbound call to HubSpot
 * (`packages/shared/src/adapter-auth-headers.ts`, `authType: "bearer"`).
 * Required HubSpot Service Key scopes (object scopes, granted by the human
 * who creates the key — see SPEC "Human boundaries"):
 *   crm.objects.contacts.read/write, crm.objects.deals.read/write,
 *   crm.objects.tickets.read/write, crm.schemas.contacts.read/write (the
 *   schemas pair is required for the `telegram_user_id` custom property
 *   below). Service Keys cannot receive HubSpot webhooks — fine, this demo
 *   is outbound REST only (HubSpot is called, never calls back).
 *
 * Endpoint path note (platform limitation, not a HubSpot API mismatch): the
 * connector-runtime's endpoint resolution uses each endpoint's configured
 * path VERBATIM — `args.params` is only ever appended as a query string
 * (`buildUrl` in `services/connector-runtime/src/activities/_shared/
 * http-call-with-retry.ts`), there is no `{contactId}`-style path templating
 * per invocation (`packages/shared/src/adapter-client.ts` `resolveRequest`).
 * HubSpot's per-contact-ID association GET routes
 * (`/crm/v3/objects/contacts/{contactId}/associations/deals`) therefore
 * cannot be registered as a single reusable endpoint. `list-deals-by-contact`
 * and `list-tickets-by-contact` are instead wired to HubSpot's v3 BATCH
 * associations-read routes (`POST /crm/v3/associations/contacts/{deals,
 * tickets}/batch/read`, contact id supplied in the request body — the same
 * "list associations for a contact" capability, HubSpot's documented way to
 * do it without a path-templated id) — a deliberate, documented deviation
 * from the SPEC's literal "GET" wording, not a silent workaround.
 *
 * Custom property provisioning: HubSpot's Properties API
 * (`/crm/v3/properties/contacts`) is a one-time setup call, not one of the
 * demo's 5 declared connector endpoints, so it is called directly against
 * HubSpot with `fetch` + the same Service Key — mirroring how
 * `01-telegram-channel.ts` talks directly to the Telegram Bot API (outside
 * the platform connector) for webhook registration/chat-id discovery.
 *
 * IDEMPOTENT: re-running never duplicates the connector (matched by name),
 * its endpoints (matched by method+path), its cache strategies (set once,
 * left untouched on endpoints that already carry one), or the
 * `telegram_user_id` contact property (matched by name, create-if-missing).
 */
import { ConflictError, createClient } from "@yoizen/platform-sdk";
import type {
  Connector,
  ConnectorCacheStrategy,
  ConnectorEndpoint,
  CreateConnectorEndpointInput,
  CreateConnectorInput,
} from "@yoizen/platform-sdk/connectors";
import { fail } from "./lib/fail.js";
import { log, step, warn } from "./lib/logging.js";
import { requireEnv } from "./lib/require-env.js";
import { runStage } from "./lib/run-stage.js";

// NOTE (SDK gap, reported not patched — see manual-loops/crm-support-telegram.md
// T03 report): `sdk/src/resources/connectors/index.ts` does not re-export the
// invoke-result types (`ConnectorSyncInvokeResult`, `ConnectorAsyncInvokeAccepted`,
// `ConnectorInvokeArgs`, etc.) added by `manual-loops/connector-invoke-api.md`,
// even though `ConnectorsClient.invoke()` itself IS exported and usable. Typed
// locally here instead of reaching into the resource's internal `./types.js`
// (out of bounds for a demo — demos only import the published subpath) or
// editing the SDK (out of scope for this loop).
interface HubspotSearchInvokeResult {
  invocationId: string;
  status: number;
  data: unknown;
  headers: Record<string, string>;
  cacheResult?: "hit" | "miss" | "bypass" | null;
}

// ----- Configuration ---------------------------------------------------------
const CONNECTOR_NAME = "demo-hubspot";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const TELEGRAM_USER_ID_PROPERTY = "telegram_user_id";

// A read/list cache strategy: short TTL so the demo can show a cache
// miss (first call) then a hit (repeat call) — `list-deals-by-contact`/
// `list-tickets-by-contact` are POST batch/read calls, keyed on the request
// body (the contact id), not query params.
const READ_CACHE_TTL_SECONDS = Number(
  process.env.HUBSPOT_CACHE_TTL_SECONDS ?? "60"
);
const readCacheStrategy: ConnectorCacheStrategy = {
  enabled: true,
  ttlSeconds: READ_CACHE_TTL_SECONDS,
  methods: ["POST"],
  keyHeaders: [],
  keyQueryParams: [],
  keyBody: true,
};

interface EndpointConfig extends CreateConnectorEndpointInput {
  method: string;
  path: string;
}

const ENDPOINTS: EndpointConfig[] = [
  {
    label: "Search contacts (filtered)",
    method: "POST",
    path: "/crm/v3/objects/contacts/search",
    // Uncached: search results must always reflect the latest contact state.
  },
  {
    label: "Create contact",
    method: "POST",
    path: "/crm/v3/objects/contacts",
    // Uncached: write endpoint.
  },
  {
    label: "List deals associated with contact(s) (batch read)",
    method: "POST",
    path: "/crm/v3/associations/contacts/deals/batch/read",
    cache: readCacheStrategy,
  },
  {
    label: "List tickets associated with contact(s) (batch read)",
    method: "POST",
    path: "/crm/v3/associations/contacts/tickets/batch/read",
    cache: readCacheStrategy,
  },
  {
    label: "Create ticket",
    method: "POST",
    path: "/crm/v3/objects/tickets",
    // Uncached: write endpoint.
  },
];

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface HubspotConnectorResult {
  connectorId: string;
  propertyEnsured: boolean;
  smokeCheckStatus: number;
}

export async function main(): Promise<HubspotConnectorResult> {
  // ----- Stage 1: preflight -------------------------------------------------
  const { tenant, email, password, baseUrl, hostHeader, hubspotServiceKey } =
    await runStage("preflight", async () => {
      const tenant = requireEnv("YOIZEN_TENANT");
      const email = requireEnv("YOIZEN_EMAIL");
      const password = requireEnv("YOIZEN_PASSWORD");
      const baseUrl = requireEnv("YOIZEN_BASE_URL");
      const hubspotServiceKey = requireEnv("HUBSPOT_SERVICE_KEY");
      const hostHeader = process.env.YOIZEN_HOST_HEADER;
      log(
        `YOIZEN_BASE_URL=${baseUrl}  tenant=${tenant}  connector=${CONNECTOR_NAME}  endpoints=${ENDPOINTS.length}`
      );
      return {
        tenant,
        email,
        password,
        baseUrl,
        hostHeader,
        hubspotServiceKey,
      };
    });

  // The gateway's dev ingress routes by Host header; the SDK's fetch-based
  // transport needs it passed as a regular header when talking to a bare
  // IP/localhost port (see 01-telegram-channel.ts / http-connectors/setup.ts).
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

  // ----- Stage 2: ensure the demo-hubspot connector -------------------------
  const connectorId = await runStage(
    `ensure connector '${CONNECTOR_NAME}'`,
    async () => {
      const connectorInput: CreateConnectorInput = {
        name: CONNECTOR_NAME,
        context: "external",
        baseUrl: HUBSPOT_API_BASE,
        authType: "bearer",
        authConfig: { bearerToken: hubspotServiceKey },
        timeoutMs: 10000,
        maxRetries: 2,
        retryBackoffMs: 300,
        healthCheckPath: "/crm/v3/objects/contacts?limit=1",
        tags: ["demo", "crm-support-telegram", "hubspot"],
        endpoints: [],
      };

      const all: Connector[] = [];
      for await (const connector of client.connectors.list({
        context: "external",
      })) {
        all.push(connector);
      }
      const matching = all.filter((c) => c.name === CONNECTOR_NAME);

      if (matching.length > 1) {
        warn(
          `duplicate connectors named '${CONNECTOR_NAME}' (${matching.length} found) — auto-healing, keeping first`
        );
        for (const stale of matching.slice(1)) {
          log(`  deleting duplicate connector ${stale.id}`);
          await client.connectors.remove(stale.id).catch(() => undefined);
        }
      }

      let id: string | undefined = matching[0]?.id;

      if (id) {
        log(`reuse  '${CONNECTOR_NAME}' — exists (id=${id})`);
        await client.connectors
          .update(id, {
            baseUrl: connectorInput.baseUrl,
            authType: connectorInput.authType,
            authConfig: connectorInput.authConfig,
            timeoutMs: connectorInput.timeoutMs,
            maxRetries: connectorInput.maxRetries,
            retryBackoffMs: connectorInput.retryBackoffMs,
            healthCheckPath: connectorInput.healthCheckPath,
            tags: connectorInput.tags,
          })
          .then(() => log(`    config reconciled (auth token refreshed)`))
          .catch((e) => {
            warn(`    ! config reconcile failed: ${messageOf(e)}`);
          });
      } else {
        try {
          const created = await client.connectors.create(connectorInput);
          id = created.id;
          log(`create '${CONNECTOR_NAME}' (auth=bearer) -> id=${id}`);
        } catch (e) {
          if (e instanceof ConflictError) {
            const refreshed: Connector[] = [];
            for await (const connector of client.connectors.list({
              context: "external",
            })) {
              refreshed.push(connector);
            }
            id = refreshed.find((c) => c.name === CONNECTOR_NAME)?.id;
            warn(
              `reuse  '${CONNECTOR_NAME}' — create returned 'already exists' (idempotent)`
            );
          } else {
            fail(`connector create FAILED: ${messageOf(e)}`);
          }
        }
      }

      if (!id) {
        fail(`could not resolve connector id for '${CONNECTOR_NAME}'`);
      }

      // Reconcile endpoints — add any (method, path) not already registered,
      // leaving already-present ones (and their cache config) untouched.
      const current = await client.connectors.get(id);
      let added = 0;
      for (const ep of ENDPOINTS) {
        const exists = current.endpoints.some(
          (e) => e.method === ep.method && e.path === ep.path
        );
        if (exists) {
          continue;
        }
        try {
          await client.connectors.addEndpoint(id, ep);
          log(
            `    + ${ep.method} ${ep.path}  (${ep.label})${ep.cache ? `  cache=${ep.cache.ttlSeconds}s` : ""}`
          );
          added += 1;
        } catch (e) {
          if (e instanceof ConflictError) {
            // raced with a concurrent run — already present, fine
            continue;
          }
          fail(
            `endpoint add FAILED for ${ep.method} ${ep.path}: ${messageOf(e)}`
          );
        }
      }
      if (added === 0) {
        log("    endpoints already up to date");
      }

      return id;
    }
  );

  // ----- Stage 3: ensure the telegram_user_id custom contact property -------
  const propertyEnsured = await runStage(
    `ensure custom contact property '${TELEGRAM_USER_ID_PROPERTY}'`,
    async () => {
      const propertyUrl = `${HUBSPOT_API_BASE}/crm/v3/properties/contacts/${TELEGRAM_USER_ID_PROPERTY}`;
      const getResp = await fetch(propertyUrl, {
        headers: { Authorization: `Bearer ${hubspotServiceKey}` },
      });

      if (getResp.ok) {
        log(`property '${TELEGRAM_USER_ID_PROPERTY}' already exists — reused`);
        return true;
      }
      if (getResp.status !== 404) {
        const body = await getResp.text();
        fail(
          `unexpected response checking property '${TELEGRAM_USER_ID_PROPERTY}': HTTP ${getResp.status} ${body}`
        );
      }

      log(`property '${TELEGRAM_USER_ID_PROPERTY}' not found — creating`);
      const createResp = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/properties/contacts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hubspotServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: TELEGRAM_USER_ID_PROPERTY,
            label: "Telegram User ID",
            type: "string",
            fieldType: "text",
            groupName: "contactinformation",
            description:
              "Telegram chat/user id — search key used by the crm-support-telegram demo's search-contact endpoint.",
          }),
        }
      );

      if (createResp.status === 409) {
        warn(
          `property '${TELEGRAM_USER_ID_PROPERTY}' create returned 409 — raced with a concurrent run, treating as reused`
        );
        return true;
      }
      if (!createResp.ok) {
        const body = await createResp.text();
        fail(`property create FAILED: HTTP ${createResp.status} ${body}`);
      }
      log(`property '${TELEGRAM_USER_ID_PROPERTY}' created`);
      return true;
    }
  );

  // ----- Stage 4: smoke check — sync invoke of search-contact ---------------
  const smokeCheckStatus = await runStage(
    "smoke check: connectors.invoke() search-contact",
    async () => {
      const connector = await client.connectors.get(connectorId);
      const searchEndpoint = connector.endpoints.find(
        (e: ConnectorEndpoint) =>
          e.method === "POST" && e.path === "/crm/v3/objects/contacts/search"
      );
      if (!searchEndpoint) {
        fail("search-contact endpoint not found on connector after reconcile");
      }

      const result: HubspotSearchInvokeResult = await client.connectors.invoke(
        connectorId,
        searchEndpoint.id,
        {
          method: "POST",
          data: {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: TELEGRAM_USER_ID_PROPERTY,
                    operator: "EQ",
                    value: "smoke-check-probe",
                  },
                ],
              },
            ],
            limit: 1,
          },
        }
      );

      log(
        `search-contact invoke -> status=${result.status} cacheResult=${result.cacheResult ?? "n/a"} invocationId=${result.invocationId}`
      );
      if (result.status !== 200) {
        fail(
          `smoke check FAILED: expected HTTP 200 from HubSpot, got ${result.status}: ${JSON.stringify(result.data)}`
        );
      }
      return result.status;
    }
  );

  return { connectorId, propertyEnsured, smokeCheckStatus };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .then((result) => {
      console.log();
      step("resolved artifacts");
      log(`connector_id=${result.connectorId}`);
      log(`property_ensured=${result.propertyEnsured}`);
      log(`smoke_check_status=${result.smokeCheckStatus}`);
    })
    .catch((e) => {
      fail(
        `02-hubspot-connector failed: ${e instanceof Error ? e.message : e}`
      );
    });
}
