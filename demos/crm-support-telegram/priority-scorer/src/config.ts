/**
 * Reads the runtime configuration this hosted service needs — set as
 * `envVars` on the Knative service registration (`../src/04-priority-scorer.ts`),
 * NOT hardcoded here (SPEC T05 constraint: "the scorer receives its
 * platform/HubSpot credentials via env/service config at registration,
 * never hardcoded").
 *
 * Fails loudly on startup if a required var is missing — nothing here fails
 * silently at request time instead.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

export interface ScorerConfig {
  /** Platform credentials the scorer uses to call `connectors.invoke()`. */
  yoizenTenant: string;
  yoizenEmail: string;
  yoizenPassword: string;
  /** In-cluster gateway base URL (e.g. `http://api-gateway.platform-services-dev.svc.cluster.local`). */
  yoizenBaseUrl: string;
  /** `demo-hubspot` connector id, resolved once at registration time. */
  hubspotConnectorId: string;
  /** `list-deals-by-contact` endpoint id. */
  hubspotDealsEndpointId: string;
  /** `list-tickets-by-contact` endpoint id. */
  hubspotTicketsEndpointId: string;
  /** `create-ticket` endpoint id. */
  hubspotCreateTicketEndpointId: string;
  /** This service's own in-cluster URL, used to build the `/tickets` webhook target. */
  selfInternalBaseUrl: string;
  /** HTTP port to listen on — Knative injects `PORT`; never hardcode/override it. */
  port: number;
}

export function loadConfig(): ScorerConfig {
  return {
    yoizenTenant: requireEnv("YOIZEN_TENANT"),
    yoizenEmail: requireEnv("YOIZEN_EMAIL"),
    yoizenPassword: requireEnv("YOIZEN_PASSWORD"),
    yoizenBaseUrl: requireEnv("YOIZEN_BASE_URL"),
    hubspotConnectorId: requireEnv("HUBSPOT_CONNECTOR_ID"),
    hubspotDealsEndpointId: requireEnv("HUBSPOT_DEALS_ENDPOINT_ID"),
    hubspotTicketsEndpointId: requireEnv("HUBSPOT_TICKETS_ENDPOINT_ID"),
    hubspotCreateTicketEndpointId: requireEnv(
      "HUBSPOT_CREATE_TICKET_ENDPOINT_ID"
    ),
    selfInternalBaseUrl: requireEnv("SELF_INTERNAL_BASE_URL"),
    // Knative sets PORT on the container; default 8080 only for local `bun test`/dev runs.
    port: Number(process.env.PORT ?? "8080"),
  };
}
