// `IPlatformResourceClient` for registry-service's `GET /services` (hosted
// services referenced by the manifest's `services` section, per SPEC's
// "serviceRef resolves through registry-service, same rule as workflow
// serviceCall").
//
// The live projection uses `serviceComparable.fromLive` — the SAME contract
// the manifest desired projection uses — so a matching service converges to
// `noop`. Comparison is env var NAMES only (never values, never secretRef
// bindings, never image/buildRef); see `comparable-fields.ts` for why.
//
// T05 (manual-loops/provisioning-manifest-gaps.md, gap 5): this is a BESPOKE
// client, not the generic `createHttpListResourceClient` factory, for two
// reasons:
//   1. Route comparison needs a SECOND call — `GET /services/:id/routes` —
//      per matched service (`GET /services`'s list response never embeds
//      routes; unlike connector-admin's endpoints, which ARE embedded in its
//      list response). Only fetched for a service that already has a live
//      match — a just-to-be-created service has no live routes yet.
//   2. `serviceComparable.fromLive` takes the manifest's OWN declared
//      resource as a second argument so it only compares an optional
//      scaling field when the manifest declares it (decision 6 — never
//      invent a comparison against a server default the manifest never
//      asked about). `findByName`'s `declaredResource` parameter carries
//      that value through from `build-manifest-plan.ts`.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { HostedService } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  IPlatformResourceClient,
  LivePlatformResource,
} from "../domain/platform-resource-client.interface";
import {
  type RegisteredServiceDto,
  type RegisteredServiceRouteDto,
  serviceComparable,
} from "../lib/comparable-fields";

const DEFAULT_TIMEOUT_MS = 10_000;

interface RawRegisteredService {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly envVars?: Record<string, string>;
  readonly port?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly concurrencyTarget?: number;
}

export function createRegistryServicesClient(
  baseUrl: string
): IPlatformResourceClient {
  const logger = new PinoLoggerService("plan.service-client");

  async function fetchLiveRoutes(
    tenantId: string,
    serviceId: string,
    serviceName: string
  ): Promise<
    | {
        readonly ok: true;
        readonly value: readonly RegisteredServiceRouteDto[];
      }
    | {
        readonly ok: false;
        readonly error: { readonly message: string };
      }
  > {
    const url = `${baseUrl}/services/${serviceId}/routes`;
    logger.log(
      `findByName: GET ${url} service='${serviceName}' tenant='${tenantId}' (live routes for comparison)`
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
      logger.warn(`findByName: ${message}`);
      return { ok: false, error: { message } };
    }

    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from ${url}`;
      logger.warn(`findByName: ${message}`);
      return { ok: false, error: { message } };
    }

    let body: {
      pathPrefix: string;
      methods: string[];
      isPublic: boolean;
      stripPrefix: boolean;
    }[];
    try {
      body = (await response.json()) as {
        pathPrefix: string;
        methods: string[];
        isPublic: boolean;
        stripPrefix: boolean;
      }[];
    } catch (cause) {
      const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`findByName: ${message}`);
      return { ok: false, error: { message } };
    }
    return {
      ok: true,
      value: body.map((route) => ({
        pathPrefix: route.pathPrefix,
        methods: route.methods,
        isPublic: route.isPublic,
        stripPrefix: route.stripPrefix,
      })),
    };
  }

  return {
    async findByName(tenantId, name, declaredResourceUnknown) {
      const url = `${baseUrl}/services`;
      logger.log(
        `findByName: GET ${url} kind='service' name='${name}' tenant='${tenantId}'`
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
        logger.warn(`findByName: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`findByName: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: name,
            message,
          },
        };
      }

      let items: RawRegisteredService[];
      try {
        items = (await response.json()) as RawRegisteredService[];
      } catch (cause) {
        const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`findByName: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: name,
            message,
          },
        };
      }
      const match = items.find((item) => item.name === name);

      if (!match) {
        logger.log(
          `findByName: no live service named '${name}' for tenant='${tenantId}'`
        );
        return { ok: true, value: null };
      }

      const routesResult = await fetchLiveRoutes(tenantId, match.id, name);
      if (!routesResult.ok) {
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: name,
            message: routesResult.error.message,
          },
        };
      }

      const dto: RegisteredServiceDto = {
        id: match.id,
        name: match.name,
        image: match.image,
        envVars: match.envVars,
        port: match.port,
        minScale: match.minScale,
        maxScale: match.maxScale,
        concurrencyTarget: match.concurrencyTarget,
        routes: routesResult.value,
      };
      const declaredResource = declaredResourceUnknown as
        | HostedService
        | undefined;

      const value: LivePlatformResource = {
        externalId: dto.id,
        fields: serviceComparable.fromLive(dto, declaredResource),
      };
      logger.log(
        `findByName: matched service '${name}' -> externalId='${value.externalId}'`
      );
      return { ok: true, value };
    },
  };
}
