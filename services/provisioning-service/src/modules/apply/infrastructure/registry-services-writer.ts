// `IPlatformResourceWriter` for registry-service's `POST /services` /
// `PATCH /services/:id`.
//
// `HostedService.image`/`buildRef` are references (never inline code, SPEC
// decision). Only `image` is supported today — registry-service has no
// buildRef -> image resolution path (see `comparable-fields.ts`'s note on
// `serviceComparable`), so a `buildRef`-declared service fails loud instead
// of guessing an image.
//
// Env vars: `ServiceEnvVar` only carries `{name, secretRef}` — the manifest
// schema has NO plain-value field (SPEC decision 3: secrets never inline).
// Every env var therefore requires the T05 secrets broker to resolve a real
// value; T04 supports ONLY services with an EMPTY `env` list. A non-empty
// `env` fails loud with `secret_not_resolvable`.
//
// T05 (manual-loops/provisioning-manifest-gaps.md, gap 5): scaling fields
// (`port`/`minScale`/`maxScale`/`concurrencyTarget`) are ALL optional and
// only sent to registry-service when the manifest actually declares them —
// an omitted field is simply absent from the request body, so
// registry-service's own server-side default wins (decision 6: "the
// manifest never invents defaults client-side").
//
// `routes` (T05) are reconciled by `pathPrefix` AFTER the service itself is
// created/resolved, via registry-service's `POST/GET/DELETE
// /services/:id/routes` (the exact routes the SDK's `client.registry.routes`
// exposes — see `sdk/src/resources/registry/client.ts`, which has NO update
// verb). Reconciliation mechanics, documented per decision 6's ruling:
//   - route absent live -> POST create.
//   - route present live, unchanged (methods/isPublic/stripPrefix,
//     normalized) -> no-op.
//   - route present live, changed -> DELETE then POST (remove-then-recreate
//     — the ONLY way to change a route server-side; this is reconciliation
//     of a sub-resource THIS manifest entry manages, not the "no prune"
//     decision 2 forbids, since nothing manifest-unlisted is ever removed).
//
// COLLISION CHECK (decision 6 ruling, 2026-07-16): `registry.routes` are NOT
// tenant-isolated at the live gateway proxy layer (see
// `sdk/src/resources/registry/types.ts` CAUTION). Immediately before writing
// ANY route, this writer independently re-lists every LIVE route globally
// (`GET /routes` root discovery) and refuses to proceed — typed
// `route_collision` error, naming the pathPrefix and the existing owner —
// if a declared `pathPrefix` already belongs to a DIFFERENT service/tenant.
// This is the SAME check `build-manifest-plan.ts` surfaces as an
// informational `route_collision` precondition at plan time; re-verifying it
// here is the actual enforcement point (mirrors how `missing_secret` is
// informational at plan time but actually enforced by a writer's broker
// resolution).

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { HostedService, ManifestServiceRoute } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

interface LiveRoute {
  readonly id: string;
  readonly pathPrefix: string;
  readonly methods: string[];
  readonly isPublic: boolean;
  readonly stripPrefix: boolean;
}

interface GlobalLiveRoute {
  readonly pathPrefix: string;
  readonly serviceName: string;
  readonly tenantId: string;
}

/** Server-side default (mirrors `RoutesService.create`), used ONLY to detect a real change — never sent when the manifest omits `methods`. */
const DEFAULT_ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function normalizeMethods(methods: readonly string[] | undefined): string[] {
  return [...(methods ?? DEFAULT_ROUTE_METHODS)]
    .map((method) => method.toUpperCase())
    .sort();
}

function routeChanged(live: LiveRoute, desired: ManifestServiceRoute): boolean {
  const liveMethods = normalizeMethods(live.methods);
  const desiredMethods = normalizeMethods(desired.methods);
  if (liveMethods.length !== desiredMethods.length) {
    return true;
  }
  if (liveMethods.some((method, i) => method !== desiredMethods[i])) {
    return true;
  }
  if (live.isPublic !== (desired.isPublic ?? false)) {
    return true;
  }
  if (live.stripPrefix !== (desired.stripPrefix ?? true)) {
    return true;
  }
  return false;
}

export function createRegistryServicesWriter(
  baseUrl: string
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.service-writer");

  function checkEnvSupport(
    service: HostedService
  ): { ok: true } | { ok: false; message: string } {
    if (service.env && service.env.length > 0) {
      return {
        ok: false,
        message: `hosted service '${service.name}' declares env vars — every manifest env var requires a secretRef (SPEC decision 3), and the secrets broker lands in T05, so no real value can be resolved yet`,
      };
    }
    return { ok: true };
  }

  /** Only the scaling keys the manifest ACTUALLY declares — never fabricates a value for an omitted field. */
  function scalingFieldsOf(service: HostedService): Record<string, number> {
    const fields: Record<string, number> = {};
    if (service.port !== undefined) {
      fields.port = service.port;
    }
    if (service.minScale !== undefined) {
      fields.minScale = service.minScale;
    }
    if (service.maxScale !== undefined) {
      fields.maxScale = service.maxScale;
    }
    if (service.concurrencyTarget !== undefined) {
      fields.concurrencyTarget = service.concurrencyTarget;
    }
    return fields;
  }

  async function fetchGlobalLiveRoutes(
    serviceName: string
  ): Promise<
    | { ok: true; value: readonly GlobalLiveRoute[] }
    | { ok: false; error: ApplyWriteError }
  > {
    const url = `${baseUrl}/routes`;
    logger.log(
      `reconcile-routes: GET ${url} (global discovery, collision check for service='${serviceName}')`
    );
    let response: Response;
    try {
      response = await tracedFetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from ${url}`;
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    let body: GlobalLiveRoute[];
    try {
      body = (await response.json()) as GlobalLiveRoute[];
    } catch (cause) {
      const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    return { ok: true, value: body };
  }

  async function checkRouteCollisions(
    tenantId: string,
    serviceName: string,
    routes: readonly ManifestServiceRoute[]
  ): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
    const globalRoutes = await fetchGlobalLiveRoutes(serviceName);
    if (!globalRoutes.ok) {
      return globalRoutes;
    }
    for (const route of routes) {
      const collision = globalRoutes.value.find(
        (existing) =>
          existing.pathPrefix === route.pathPrefix &&
          !(
            existing.tenantId === tenantId &&
            existing.serviceName === serviceName
          )
      );
      if (collision) {
        const message = `route pathPrefix '${route.pathPrefix}' declared by service '${serviceName}' collides with an existing route owned by service '${collision.serviceName}' (tenant '${collision.tenantId}') — registry.routes are not tenant-isolated at the live gateway proxy layer`;
        logger.warn(`reconcile-routes: ${message}`);
        return {
          ok: false,
          error: {
            kind: "route_collision",
            resourceKind: "service",
            resourceName: serviceName,
            message,
          },
        };
      }
    }
    return { ok: true };
  }

  async function fetchServiceRoutes(
    tenantId: string,
    serviceName: string,
    serviceExternalId: string
  ): Promise<
    | { ok: true; value: readonly LiveRoute[] }
    | { ok: false; error: ApplyWriteError }
  > {
    const url = `${baseUrl}/services/${serviceExternalId}/routes`;
    logger.log(
      `reconcile-routes: GET ${url} service='${serviceName}' tenant='${tenantId}'`
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
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from ${url}`;
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    let body: LiveRoute[];
    try {
      body = (await response.json()) as LiveRoute[];
    } catch (cause) {
      const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    return { ok: true, value: body };
  }

  async function writeRoute(
    tenantId: string,
    serviceName: string,
    serviceExternalId: string,
    verb: "POST" | "DELETE",
    route?: ManifestServiceRoute,
    routeId?: string
  ): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
    const url =
      verb === "POST"
        ? `${baseUrl}/services/${serviceExternalId}/routes`
        : `${baseUrl}/services/${serviceExternalId}/routes/${String(routeId)}`;
    logger.log(
      `reconcile-routes: ${verb} ${url} service='${serviceName}' tenant='${tenantId}'` +
        (route ? ` pathPrefix='${route.pathPrefix}'` : "")
    );
    try {
      const response = await tracedFetch(url, {
        method: verb,
        headers: {
          [TENANT_HEADER]: tenantId,
          "content-type": "application/json",
        },
        body: route ? JSON.stringify(route) : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`reconcile-routes: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: serviceName,
            message,
          },
        };
      }
    } catch (cause) {
      const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`reconcile-routes: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "service",
          resourceName: serviceName,
          message,
        },
      };
    }
    return { ok: true };
  }

  async function reconcileRoutes(
    tenantId: string,
    service: HostedService,
    serviceExternalId: string
  ): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
    const desiredRoutes = service.routes ?? [];
    if (desiredRoutes.length === 0) {
      return { ok: true };
    }

    const collisionCheck = await checkRouteCollisions(
      tenantId,
      service.name,
      desiredRoutes
    );
    if (!collisionCheck.ok) {
      return collisionCheck;
    }

    const existing = await fetchServiceRoutes(
      tenantId,
      service.name,
      serviceExternalId
    );
    if (!existing.ok) {
      return existing;
    }

    for (const route of desiredRoutes) {
      const match = existing.value.find(
        (live) => live.pathPrefix === route.pathPrefix
      );

      if (!match) {
        const created = await writeRoute(
          tenantId,
          service.name,
          serviceExternalId,
          "POST",
          route
        );
        if (!created.ok) {
          return created;
        }
        logger.log(
          `reconcile-routes: service '${service.name}' route '${route.pathPrefix}' created`
        );
        continue;
      }

      if (!routeChanged(match, route)) {
        logger.log(
          `reconcile-routes: service '${service.name}' route '${route.pathPrefix}' unchanged — no-op`
        );
        continue;
      }

      // No update verb exists server-side (see `sdk/src/resources/registry/client.ts`
      // `RegistryRoutesClient`) — remove-then-recreate is the documented
      // reconciliation for a route THIS manifest owns (decision 6 ruling).
      // ACCEPTED TRANSIENT WINDOW: if DELETE succeeds but the recreate POST
      // fails, the route is left ABSENT until the next apply re-runs this
      // reconcile and self-heals — fail-loud (typed downstream_error below),
      // never silently swallowed, and always recoverable by re-applying.
      logger.log(
        `reconcile-routes: service '${service.name}' route '${route.pathPrefix}' changed — remove-then-recreate`
      );
      const removed = await writeRoute(
        tenantId,
        service.name,
        serviceExternalId,
        "DELETE",
        undefined,
        match.id
      );
      if (!removed.ok) {
        return removed;
      }
      const recreated = await writeRoute(
        tenantId,
        service.name,
        serviceExternalId,
        "POST",
        route
      );
      if (!recreated.ok) {
        return recreated;
      }
    }

    return { ok: true };
  }

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const service = resourceUnknown as HostedService;

      if (!service.image) {
        const message = `hosted service '${service.name}' declares buildRef ('${String(service.buildRef)}') — registry-service has no buildRef -> image resolution path yet; only image-referenced services are supported`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "unsupported_kind_shape",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      const envCheck = checkEnvSupport(service);
      if (!envCheck.ok) {
        logger.warn(`create: ${envCheck.message}`);
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "service",
            resourceName: service.name,
            message: envCheck.message,
          },
        };
      }

      const url = `${baseUrl}/services`;
      const scalingFields = scalingFieldsOf(service);
      logger.log(
        `create: POST ${url} service='${service.name}' image='${service.image}' tenant='${tenantId}'` +
          (Object.keys(scalingFields).length > 0
            ? ` scaling=${JSON.stringify(scalingFields)}`
            : "")
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "POST",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: service.name,
            image: service.image,
            envVars: {},
            ...scalingFields,
          }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      const created = (await response.json()) as { id: string };
      logger.log(
        `create: service '${service.name}' created -> externalId='${created.id}'`
      );

      const routesResult = await reconcileRoutes(tenantId, service, created.id);
      if (!routesResult.ok) {
        return routesResult;
      }

      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const service = resourceUnknown as HostedService;

      const envCheck = checkEnvSupport(service);
      if (!envCheck.ok) {
        logger.warn(`update: ${envCheck.message}`);
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "service",
            resourceName: service.name,
            message: envCheck.message,
          },
        };
      }

      const url = `${baseUrl}/services/${externalId}`;
      const scalingFields = scalingFieldsOf(service);
      logger.log(
        `update: PATCH ${url} service='${service.name}' tenant='${tenantId}'` +
          (Object.keys(scalingFields).length > 0
            ? ` scaling=${JSON.stringify(scalingFields)}`
            : "")
      );

      try {
        const response = await tracedFetch(url, {
          method: "PATCH",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify({ envVars: {}, ...scalingFields }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) {
          const message = `HTTP ${String(response.status)} from ${url}`;
          logger.warn(`update: ${message}`);
          return {
            ok: false,
            error: {
              kind: "downstream_error",
              resourceKind: "service",
              resourceName: service.name,
              message,
            },
          };
        }
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`update: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      const routesResult = await reconcileRoutes(tenantId, service, externalId);
      if (!routesResult.ok) {
        return routesResult;
      }

      return { ok: true, value: { externalId } };
    },
  };
}
