// Real `RouteCollisionChecker` backed by registry-service's `GET /routes`
// root discovery endpoint (`RoutesService.discover()` — the SAME global,
// cross-tenant view the api-gateway's dynamic router polls every 15s; see
// `sdk/src/resources/registry/types.ts` CAUTION). Read-only, called ONCE per
// plan run by `buildManifestPlan` (T05, gap 5, decision 6 ruling).

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { RouteCollisionChecker } from "../domain/route-collision-checker.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

interface DiscoveredRouteBody {
  readonly pathPrefix: string;
  readonly serviceName: string;
  readonly tenantId: string;
}

export function createRegistryRouteCollisionChecker(
  baseUrl: string
): RouteCollisionChecker {
  const logger = new PinoLoggerService("plan.route-collision-checker");

  return {
    async listAll() {
      const url = `${baseUrl}/routes`;
      logger.log(`listAll: GET ${url} (global route discovery)`);

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`listAll: ${message}`);
        return { ok: false, error: message };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`listAll: ${message}`);
        return { ok: false, error: message };
      }

      let body: DiscoveredRouteBody[];
      try {
        body = (await response.json()) as DiscoveredRouteBody[];
      } catch (cause) {
        const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`listAll: ${message}`);
        return { ok: false, error: message };
      }

      logger.log(`listAll: ${String(body.length)} live route(s) discovered`);
      return {
        ok: true,
        value: body.map((entry) => ({
          pathPrefix: entry.pathPrefix,
          serviceName: entry.serviceName,
          tenantId: entry.tenantId,
        })),
      };
    },
  };
}
