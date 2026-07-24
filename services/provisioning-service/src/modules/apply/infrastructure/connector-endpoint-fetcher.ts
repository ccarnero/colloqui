// manual-loops/provisioning-manifest-gaps-4.md T03 — the live
// `GET /connectors/:id` implementation `resolve-service-env-refs.ts`'s
// `fetchConnectorEndpoints` closure is wired to at the composition root
// (`apply.module.ts`), mirroring `connectors-writer.ts`'s own
// `fetchLiveConnectorEndpoints` (same route, same `tracedFetch` + baseUrl
// pattern, same fail-loud-on-network/HTTP-error posture) — kept as a
// STANDALONE infra function rather than importing it out of
// `connectors-writer.ts` because that function is `connectors-writer.ts`'s
// own private helper (not exported), and duplicating the ~15-line fetch
// call here is smaller than exporting/re-plumbing a private helper across
// module boundaries for one new caller.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type {
  FetchConnectorEndpoints,
  LiveConnectorEndpointRef,
} from "../lib/resolve-service-env-refs";

const DEFAULT_TIMEOUT_MS = 10_000;

/** DI token for the `FetchConnectorEndpoints` closure, wired in `apply.module.ts`. */
export const CONNECTOR_ENDPOINT_FETCHER = Symbol("CONNECTOR_ENDPOINT_FETCHER");

/**
 * Builds the `fetchConnectorEndpoints` closure `resolveServiceEnvRefs`
 * threads for the T03 endpoint-ref shape. Fails loud (typed
 * `downstream_error`, never throws, never silently leaves the ref
 * unresolved) on network failure, a non-2xx response, or a malformed body
 * missing `.endpoints`.
 */
export function createConnectorEndpointFetcher(
  baseUrl: string
): FetchConnectorEndpoints {
  const logger = new PinoLoggerService("apply.connector-endpoint-fetcher");

  return async function fetchConnectorEndpoints(
    tenantId: string,
    connectorExternalId: string
  ) {
    const url = `${baseUrl}/connectors/${connectorExternalId}`;
    logger.log(
      `fetch-connector-endpoints: GET ${url} tenant='${tenantId}' (service.env[] endpoint-ref resolution)`
    );

    let response: Response;
    try {
      response = await tracedFetch(url, {
        method: "GET",
        headers: { [TENANT_HEADER]: tenantId },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`fetch-connector-endpoints: ${message}`);
      const error: ApplyWriteError = {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: connectorExternalId,
        message,
      };
      return { ok: false as const, error };
    }

    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from ${url}`;
      logger.warn(`fetch-connector-endpoints: ${message}`);
      const error: ApplyWriteError = {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: connectorExternalId,
        message,
      };
      return { ok: false as const, error };
    }

    let body: { endpoints?: LiveConnectorEndpointRef[] };
    try {
      body = (await response.json()) as {
        endpoints?: LiveConnectorEndpointRef[];
      };
    } catch (cause) {
      const message = `malformed JSON body from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`fetch-connector-endpoints: ${message}`);
      const error: ApplyWriteError = {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: connectorExternalId,
        message,
      };
      return { ok: false as const, error };
    }

    const endpoints = body.endpoints ?? [];
    logger.log(
      `fetch-connector-endpoints: connector externalId='${connectorExternalId}' -> ${String(endpoints.length)} live endpoint(s)`
    );
    return { ok: true as const, endpoints };
  };
}
