// `IPlatformResourceWriter` for registry-service's `POST /services` /
// `PATCH /services/:id`.
//
// `HostedService.image`/`buildRef` are references (never inline code, SPEC
// decision). Only `image` is supported today — registry-service has no
// buildRef -> image resolution path (see `comparable-fields.ts`'s note on
// `serviceComparable`), so a `buildRef`-declared service fails loud instead
// of guessing an image.
//
// Env vars (manual-loops/provisioning-manifest-gaps-2.md T05, gap 5 — HUMAN
// RULING 2026-07-16, PLAIN STRINGS ONLY, round 1): `ServiceEnvVar.value` was
// a plain `string` (e.g. a metadata marker like `YOIZEN_SAMPLE`). Each
// declared entry passed through verbatim into registry-service's `envVars`
// payload — no secrets broker involvement whatsoever.
//
// manual-loops/provisioning-manifest-gaps-4.md T01 (round 2, 2026-07-24)
// widens `ServiceEnvVar.value` at the SCHEMA level to a 4-shape union
// (bare string | `{ secretRef }` | `{ connectorRef }` | `{ connectorRef,
// endpointMethod, endpointPath }` — see `manifest.schema.ts`'s
// `serviceEnvVarSchema` header comment for the full history and the Option
// B ruling this reopens). T01 is SCHEMA + VALIDATE-TIME ONLY. Apply-time
// resolution of the `connectorRef`/endpoint-ref shapes ships upstream in
// `resolve-service-env-refs.ts` (T02/T03) — by the time `buildEnvVars` runs,
// those two shapes have ALREADY been substituted to plain strings (or the
// apply already failed loud before reaching this writer). `{ secretRef }`
// is DELIBERATELY left untouched by that upstream resolver — it is THIS
// writer's job (T04, Option B, human ruling 2026-07-24): the secret is
// NEVER resolved to plaintext here. `buildEnvVars` calls the T05 secrets
// broker for an EXISTENCE check ONLY (fail loud, `secret_not_resolvable`,
// if the binding is missing or no resolver is wired — mirrors
// `connectors-writer.ts`'s `resolveField`/`resolveConnectorAuth` shape) and
// then sends registry-service the REFERENCE `{ name:
// secretResourceName("service", service.name), key: secretRef }` —
// `secret-resource-name.ts:29-31` is the ONE source of truth for that name,
// reused verbatim, never re-derived inline. registry-service emits the
// k8s-native `env[].valueFrom.secretKeyRef` from that reference
// (`knative-builder.ts`) so k8s itself resolves the value at pod start —
// the mechanism `declarative-provisioning.md` decision 7 always intended.
// A ref-shaped value THIS writer does not recognize (e.g. an unresolved
// `connectorRef` reaching here — should not happen given
// `resolve-service-env-refs.ts`, but never assumed) still fails loud with
// `unresolved_symbolic_ref` exactly as before, never silently stringified
// or crashed on with an unchecked type error.
//
// LOGGING DISCIPLINE: the writer logs env var NAMES only, never values —
// literal values (plain config, not secrets) are never logged wholesale,
// and a secretRef binding name is a NAME, never the resolved secret value —
// keeping parity with every other credential-adjacent writer in this loop.
//
// COMPARABLE LIMITATION (documented, not a bug): `comparable-fields.ts`'s
// `serviceComparable` projects env var NAMES only (never values — even a
// plain value can be quasi-sensitive config, same names-only reasoning as
// T04's systemVariables, and it keeps parity). Consequence: adding/removing
// an env NAME produces an `update` verdict and this writer re-sends the full
// `envVars` map; a VALUE-only change (same name, changed value) produces NO
// diff at plan time, so this writer is never invoked for that change and the
// live env var is NOT reconciled until some OTHER field on the service also
// changes. This mirrors the T02-endpoints cache-exclusion precedent: an
// accepted, explicitly documented limitation, not a defect to silently work
// around.
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
import { DEFAULT_ROUTE_METHODS } from "../../../lib/default-route-methods";
import { secretResourceName } from "../../secrets/lib/secret-resource-name";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "../domain/secret-value-resolver.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The env value shape sent to registry-service's `POST/PATCH /services`
 * body — widened at manual-loops/provisioning-manifest-gaps-4.md T04
 * (Option B) alongside `registry-service`'s own `services.dto.ts`
 * `ServiceEnvVarValue`. A literal string is unchanged; a `secretRef` env
 * var resolves to the k8s-native reference, never a plaintext value.
 */
type RegistryEnvVarValue =
  | string
  | { readonly secretKeyRef: { readonly name: string; readonly key: string } };
type RegistryEnvVars = Record<string, RegistryEnvVarValue>;

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
  baseUrl: string,
  secretResolver?: ISecretValueResolver
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.service-writer");

  /**
   * `env[].value` -> registry-service's `envVars` payload. A plain string
   * (T05, gap 5) is mapped verbatim (unchanged — no broker involvement).
   *
   * manual-loops/provisioning-manifest-gaps-4.md T04 (Option B, human
   * ruling 2026-07-24): a `{ secretRef }` value is resolved through the T05
   * secrets broker for an EXISTENCE CHECK ONLY — `secretResolver.resolve()`
   * is called and only its `.ok` outcome is inspected, `.value` (the
   * resolved plaintext) is NEVER read or forwarded. On success this writer
   * sends registry-service the REFERENCE `{ name: secretResourceName(
   * "service", service.name), key: secretRef }` (`secret-resource-name.ts`
   * lines 29-31 is the ONE naming source of truth, reused verbatim) instead
   * of a value — registry-service turns that into the k8s-native
   * `env[].valueFrom.secretKeyRef` (`knative-builder.ts`), so k8s itself
   * resolves the value at pod start. Missing binding or no resolver wired
   * -> typed `secret_not_resolvable` (mirrors `connectors-writer.ts`'s
   * `resolveField` fail-loud shape).
   *
   * `{ connectorRef }`/endpoint-ref shapes are resolved UPSTREAM
   * (`resolve-service-env-refs.ts`, T02/T03) before this writer ever runs —
   * an unresolved ref-shaped value reaching here (should not happen) still
   * fails loud with `unresolved_symbolic_ref`, never silently stringified.
   *
   * LOGGING: env var NAMES only, never values — literal values are never
   * logged wholesale, and a secretRef binding NAME is safe to log (it is a
   * name, never the resolved secret value).
   */
  async function buildEnvVars(
    service: HostedService,
    verb: "create" | "update",
    tenantId: string,
    correlationId: string | undefined
  ): Promise<
    { ok: true; value: RegistryEnvVars } | { ok: false; error: ApplyWriteError }
  > {
    const declared = service.env ?? [];
    const envVars: RegistryEnvVars = {};
    for (const envVar of declared) {
      if (typeof envVar.value === "string") {
        envVars[envVar.name] = envVar.value;
        continue;
      }

      if (!("secretRef" in envVar.value)) {
        // connectorRef / endpoint-ref shapes are resolved upstream
        // (resolve-service-env-refs.ts, T02/T03) before this writer ever
        // sees the service — reaching here unresolved is a dependency-order
        // gap that must fail loud, never be silently stringified.
        const message = `service '${service.name}' env var '${envVar.name}' declares a { connectorRef } value that was never resolved before reaching this writer (expected upstream resolution — manual-loops/provisioning-manifest-gaps-4.md T02/T03)`;
        logger.warn(`${verb}: ${message}`);
        return {
          ok: false,
          error: {
            kind: "unresolved_symbolic_ref",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      const secretRef = envVar.value.secretRef;
      if (!secretResolver) {
        const message = `service '${service.name}' env var '${envVar.name}' declares a { secretRef } value ('${secretRef}') but no secrets broker resolver is wired`;
        logger.warn(`${verb}: ${message}`);
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      // Existence check ONLY — `.value` (the resolved plaintext) is
      // deliberately never read; only the `.ok` outcome matters here.
      const resolution = await secretResolver.resolve({
        tenantId,
        kind: "service",
        owner: service.name,
        secretName: secretRef,
        correlationId,
      });
      if (!resolution.ok) {
        const message = `service '${service.name}' env var '${envVar.name}' secretRef '${secretRef}' broker existence check FAILED: ${resolution.error}`;
        logger.warn(`${verb}: ${message}`);
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "service",
            resourceName: service.name,
            message,
          },
        };
      }

      logger.log(
        `${verb}: service '${service.name}' env var '${envVar.name}' secretRef '${secretRef}' EXISTS — sending registry-service a k8s-native secretKeyRef reference (value NEVER resolved/forwarded)`
      );
      // secret-resource-name.ts:29-31 — the ONE source of truth for this
      // name, reused verbatim, never re-derived inline.
      envVars[envVar.name] = {
        secretKeyRef: {
          name: secretResourceName("service", service.name),
          key: secretRef,
        },
      };
    }
    if (declared.length > 0) {
      logger.log(
        `${verb}: service '${service.name}' env vars [${declared
          .map((e) => e.name)
          .join(", ")}] (values NEVER logged)`
      );
    }
    return { ok: true, value: envVars };
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
    async create(
      tenantId,
      resourceUnknown,
      context
    ): Promise<CreateOrUpdateResult> {
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

      const envVarsResult = await buildEnvVars(
        service,
        "create",
        tenantId,
        context?.correlationId
      );
      if (!envVarsResult.ok) {
        return envVarsResult;
      }
      const envVars = envVarsResult.value;

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
            envVars,
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
      resourceUnknown,
      _diff,
      context
    ): Promise<CreateOrUpdateResult> {
      const service = resourceUnknown as HostedService;

      const envVarsResult = await buildEnvVars(
        service,
        "update",
        tenantId,
        context?.correlationId
      );
      if (!envVarsResult.ok) {
        return envVarsResult;
      }
      const envVars = envVarsResult.value;

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
          body: JSON.stringify({ envVars, ...scalingFields }),
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
