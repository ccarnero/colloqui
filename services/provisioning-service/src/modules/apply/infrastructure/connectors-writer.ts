// `IPlatformResourceWriter` for connector-admin's `POST /connectors`.
//
// connector-admin's `CreateAdapterDto` requires a real `baseUrl` — that is
// plain infra wiring (not a credential), so it is read straight off the
// manifest's `config.baseUrl` (never fabricated; missing -> typed error).
//
// T01 (manual-loops/provisioning-manifest-gaps.md, gap 1, decision 3 ruling
// 2026-07-16): a connector's `auth` block (see `manifest.schema.ts`) is
// resolved through the SAME secrets-broker resolver `channels-writer.ts`
// already uses (`ISecretValueResolver`, wired at the module boundary in
// `platform-resource-writers.provider.ts` / `apply.module.ts` via
// `BrokerSecretResolver`, whose consumer identity is the fixed
// `provisioning-service-apply-engine` literal — REUSED here rather than
// registering a new consumer identity, since `secret-consumer-policy.ts`'s
// static allow-set already authorizes the apply engine for every
// `ResourceKind`, including `connector`; a new identity would only be
// needed if a DIFFERENT service, not the apply engine, were the caller).
// A connector declaring `auth` with NO resolver wired (tests, or a
// not-yet-bound secret) fails loud with a typed `secret_not_resolvable`
// error, exactly like the T04/T05 fail-loud precedent. The resolved value
// is NEVER logged — only the outcome (resolved vs. failed) and field NAMES.
//
// T02 (manual-loops/provisioning-manifest-gaps.md, gap 2): `connector.endpoints`
// is reconciled AFTER the connector itself is created/resolved, in
// declaration order, via connector-admin's dedicated endpoint API —
// `POST /connectors/:id/endpoints` (create) and
// `PATCH /connectors/:id/endpoints/:epId` (update) — the SAME two routes the
// SDK's `client.connectors.addEndpoint`/`updateEndpoint` call
// (`sdk/src/resources/connectors/client.ts`). Endpoint uniqueness downstream
// is `(method, path)` per connector (never a manifest-declared id), so the
// writer matches each declared endpoint against the connector's LIVE
// endpoints by that pair to decide add-vs-update. Create-or-update only
// (decision 2, no prune) — an endpoint present live but absent from the
// manifest is left untouched. `connectorComparable` (T02) now diffs
// endpoints too, so `update()` is reachable whenever endpoints changed —
// no longer the defensive no-op stub T01 left it as.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type {
  Connector,
  ConnectorAuthType,
  ConnectorEndpointManifest,
} from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "../domain/secret-value-resolver.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Live endpoint shape read off `GET /connectors/:id` (mirrors `mapEndpoint`). */
interface LiveConnectorEndpoint {
  readonly id: string;
  readonly label: string;
  readonly method: string;
  readonly path: string;
}

/**
 * Reconciles every declared endpoint against the connector's live endpoints,
 * in declaration order. `existingEndpoints` is empty for a just-created
 * connector (nothing to match yet) and fetched from the live connector for
 * an update. Matches by `(method, path)` — connector-admin's own uniqueness
 * key — never by manifest order or a manifest-declared id. Fails loud on the
 * first endpoint API error, naming both the connector and the endpoint.
 */
async function reconcileConnectorEndpoints(
  baseUrl: string,
  logger: PinoLoggerService,
  tenantId: string,
  connectorName: string,
  externalId: string,
  endpoints: readonly ConnectorEndpointManifest[],
  existingEndpoints: readonly LiveConnectorEndpoint[]
): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
  for (const endpoint of endpoints) {
    const match = existingEndpoints.find(
      (existing) =>
        existing.method.toUpperCase() === endpoint.method.toUpperCase() &&
        existing.path === endpoint.path
    );

    const requestBody: Record<string, unknown> = {
      label: endpoint.label,
      method: endpoint.method,
      path: endpoint.path,
    };
    if (endpoint.cache) {
      requestBody.cache = endpoint.cache;
    }

    const verb = match ? "PATCH" : "POST";
    const url = match
      ? `${baseUrl}/connectors/${externalId}/endpoints/${match.id}`
      : `${baseUrl}/connectors/${externalId}/endpoints`;

    logger.log(
      `reconcile-endpoints: ${verb} ${url} connector='${connectorName}' endpoint='${endpoint.label}' (${endpoint.method} ${endpoint.path}) tenant='${tenantId}'`
    );

    let response: Response;
    try {
      response = await tracedFetch(url, {
        method: verb,
        headers: {
          [TENANT_HEADER]: tenantId,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const message = `network failure calling ${url} for connector '${connectorName}' endpoint '${endpoint.label}' (${endpoint.method} ${endpoint.path}): ${cause instanceof Error ? cause.message : String(cause)}`;
      logger.warn(`reconcile-endpoints: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "connector",
          resourceName: connectorName,
          message,
        },
      };
    }

    if (!response.ok) {
      const message = `HTTP ${String(response.status)} from ${url} for connector '${connectorName}' endpoint '${endpoint.label}' (${endpoint.method} ${endpoint.path})`;
      logger.warn(`reconcile-endpoints: ${message}`);
      return {
        ok: false,
        error: {
          kind: "downstream_error",
          resourceKind: "connector",
          resourceName: connectorName,
          message,
        },
      };
    }

    logger.log(
      `reconcile-endpoints: connector '${connectorName}' endpoint '${endpoint.label}' (${endpoint.method} ${endpoint.path}) ${match ? "updated" : "created"}`
    );
  }
  return { ok: true };
}

/**
 * Fetches the connector's current endpoints from the live platform state
 * (`GET /connectors/:id`), used ONLY on the update path — a just-created
 * connector has no live endpoints yet, so `create()` never needs this call.
 */
async function fetchLiveConnectorEndpoints(
  baseUrl: string,
  logger: PinoLoggerService,
  tenantId: string,
  connectorName: string,
  externalId: string
): Promise<
  | { ok: true; endpoints: readonly LiveConnectorEndpoint[] }
  | { ok: false; error: ApplyWriteError }
> {
  const url = `${baseUrl}/connectors/${externalId}`;
  logger.log(
    `update: GET ${url} connector='${connectorName}' tenant='${tenantId}' (fetching live endpoints for add-vs-update matching)`
  );

  let response: Response;
  try {
    response = await tracedFetch(url, {
      method: "GET",
      headers: { [TENANT_HEADER]: tenantId },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = `network failure calling ${url} for connector '${connectorName}': ${cause instanceof Error ? cause.message : String(cause)}`;
    logger.warn(`update: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: connectorName,
        message,
      },
    };
  }

  if (!response.ok) {
    const message = `HTTP ${String(response.status)} from ${url} for connector '${connectorName}'`;
    logger.warn(`update: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "connector",
        resourceName: connectorName,
        message,
      },
    };
  }

  const live = (await response.json()) as {
    endpoints?: LiveConnectorEndpoint[];
  };
  return { ok: true, endpoints: live.endpoints ?? [] };
}

type ResolveConnectorAuthOutcome =
  | {
      readonly ok: true;
      readonly authType: ConnectorAuthType;
      readonly authConfig: Record<string, unknown>;
    }
  | { readonly ok: false; readonly error: ApplyWriteError };

/**
 * Resolves every `secretRef` in a connector's `auth` block through the
 * broker and maps each resolved value into the correct connector-admin
 * `authConfig` field for the declared `authType` (see
 * `packages/shared/src/adapter-auth-headers.ts` for the field names
 * connector-admin/connector-runtime expect: `bearerToken` / `apiKey` +
 * `apiKeyHeader` / `basicUsername` + `basicPassword`). NEVER logs a
 * resolved value — only the field NAME being populated.
 */
async function resolveConnectorAuth(
  secretResolver: ISecretValueResolver | undefined,
  logger: PinoLoggerService,
  tenantId: string,
  connector: Connector,
  correlationId: string | undefined
): Promise<ResolveConnectorAuthOutcome> {
  const auth = connector.auth;
  if (!auth) {
    return { ok: true, authType: "bearer", authConfig: {} } as const;
  }

  async function resolveField(
    fieldName: string,
    secretRef: string
  ): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
    if (!secretResolver) {
      const message = `connector '${connector.name}' auth.${fieldName}.secretRef '${secretRef}' declared but no secrets broker resolver is wired`;
      logger.warn(`create: ${message}`);
      return { ok: false, error: message };
    }
    const resolved = await secretResolver.resolve({
      tenantId,
      kind: "connector",
      owner: connector.name,
      secretName: secretRef,
      correlationId,
    });
    if (!resolved.ok) {
      logger.warn(
        `create: connector '${connector.name}' auth.${fieldName}.secretRef '${secretRef}' broker resolution FAILED: ${resolved.error}`
      );
      return { ok: false, error: resolved.error };
    }
    logger.log(
      `create: connector '${connector.name}' resolved auth.${fieldName}.secretRef '${secretRef}' via the broker (value NEVER logged)`
    );
    return { ok: true, value: resolved.value };
  }

  const authConfig: Record<string, unknown> = {};

  switch (auth.authType) {
    case "bearer": {
      const resolved = await resolveField(
        "bearerToken",
        auth.bearerToken.secretRef
      );
      if (!resolved.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "connector",
            resourceName: connector.name,
            message: resolved.error,
          },
        };
      }
      authConfig.bearerToken = resolved.value;
      break;
    }
    case "api-key": {
      const resolved = await resolveField("apiKey", auth.apiKey.secretRef);
      if (!resolved.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "connector",
            resourceName: connector.name,
            message: resolved.error,
          },
        };
      }
      authConfig.apiKey = resolved.value;
      if (auth.apiKeyHeader) {
        authConfig.apiKeyHeader = auth.apiKeyHeader;
      }
      break;
    }
    case "basic": {
      const resolvedUser = await resolveField(
        "basicUsername",
        auth.basicUsername.secretRef
      );
      if (!resolvedUser.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "connector",
            resourceName: connector.name,
            message: resolvedUser.error,
          },
        };
      }
      const resolvedPass = await resolveField(
        "basicPassword",
        auth.basicPassword.secretRef
      );
      if (!resolvedPass.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "connector",
            resourceName: connector.name,
            message: resolvedPass.error,
          },
        };
      }
      authConfig.basicUsername = resolvedUser.value;
      authConfig.basicPassword = resolvedPass.value;
      break;
    }
  }

  return { ok: true, authType: auth.authType, authConfig };
}

export function createConnectorsWriter(
  baseUrl: string,
  secretResolver?: ISecretValueResolver
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.connector-writer");

  return {
    async create(
      tenantId,
      resourceUnknown,
      context
    ): Promise<CreateOrUpdateResult> {
      const connector = resourceUnknown as Connector;

      const authResolution = await resolveConnectorAuth(
        secretResolver,
        logger,
        tenantId,
        connector,
        context?.correlationId
      );
      if (!authResolution.ok) {
        return authResolution;
      }

      const config = (connector.config ?? {}) as Record<string, unknown>;
      const configBaseUrl =
        typeof config.baseUrl === "string" ? config.baseUrl : undefined;
      if (!configBaseUrl) {
        const message = `connector '${connector.name}' is missing required field config.baseUrl (connector-admin needs a real endpoint URL)`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "missing_required_field",
            resourceKind: "connector",
            resourceName: connector.name,
            message,
          },
        };
      }

      const adapterContext =
        typeof config.context === "string" ? config.context : "external";
      const url = `${baseUrl}/connectors`;
      logger.log(
        `create: POST ${url} connector='${connector.name}' tenant='${tenantId}'` +
          (connector.auth ? ` authType='${connector.auth.authType}'` : "")
      );

      const requestBody: Record<string, unknown> = {
        name: connector.name,
        context: adapterContext,
        baseUrl: configBaseUrl,
      };
      if (connector.auth) {
        requestBody.authType = authResolution.authType;
        requestBody.authConfig = authResolution.authConfig;
      }

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "POST",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "connector",
            resourceName: connector.name,
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
            resourceKind: "connector",
            resourceName: connector.name,
            message,
          },
        };
      }

      const created = (await response.json()) as { id: string };
      logger.log(
        `create: connector '${connector.name}' created -> externalId='${created.id}'`
      );

      const endpoints = connector.endpoints ?? [];
      if (endpoints.length > 0) {
        logger.log(
          `create: connector '${connector.name}' reconciling ${String(endpoints.length)} declared endpoint(s), in declaration order`
        );
        const reconciled = await reconcileConnectorEndpoints(
          baseUrl,
          logger,
          tenantId,
          connector.name,
          created.id,
          endpoints,
          []
        );
        if (!reconciled.ok) {
          return reconciled;
        }
      }

      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const connector = resourceUnknown as Connector;
      const endpoints = connector.endpoints ?? [];

      if (endpoints.length === 0) {
        logger.log(
          `update: connector '${connector.name}' declares no endpoints and has no other comparable/writable field — no-op`
        );
        return { ok: true, value: { externalId } };
      }

      const live = await fetchLiveConnectorEndpoints(
        baseUrl,
        logger,
        tenantId,
        connector.name,
        externalId
      );
      if (!live.ok) {
        return live;
      }

      logger.log(
        `update: connector '${connector.name}' reconciling ${String(endpoints.length)} declared endpoint(s) against ${String(live.endpoints.length)} live endpoint(s), in declaration order`
      );
      const reconciled = await reconcileConnectorEndpoints(
        baseUrl,
        logger,
        tenantId,
        connector.name,
        externalId,
        endpoints,
        live.endpoints
      );
      if (!reconciled.ok) {
        return reconciled;
      }

      return { ok: true, value: { externalId } };
    },
  };
}
