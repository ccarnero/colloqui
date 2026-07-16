// `IPlatformResourceWriter` for agent-admin-service's
// `POST /admin/mcp-servers` / `PATCH /admin/mcp-servers/:id`
// (manual-loops/provisioning-manifest-gaps.md T06, gap 6).
//
// AUTH (mirrors `connectors-writer.ts`'s `resolveConnectorAuth` exactly, T01
// decision-3 ruling extended to mcpServers, T06): a declared `auth` block's
// secretRef(s) are resolved through the SAME broker resolver, mapped into
// agent-admin-service's `authConfig` shape for the declared `authType`
// (field names verified against `sdk/src/resources/mcp-servers/types.ts`'s
// own doc comment: `{ headerName?, key }` for `api-key`, `{ token }` for
// `bearer`, `{ username, password }` for `basic`). NEVER logs a resolved
// value — only the field NAME being populated. No `auth` declared -> no
// resolver call, no `authType`/`authConfig` sent (server-side "none" default).
//
// HEADERS: each declared header value is EITHER a plain string (sent
// verbatim) OR a `{ secretRef }` object resolved through the SAME broker,
// mirroring `auth` field resolution — never a plaintext credential
// masquerading as a header value that this writer could accidentally log.
//
// create-or-update only (decision 2, no prune/delete anywhere in this loop).
// `mcpServerComparable` (T06, `comparable-fields.ts`) projects
// `transport_type`/`url`/`enabled` — `update()` resends the FULL desired
// `auth`/`headers` alongside whatever comparable field changed (see that
// file's header comment for the pure auth/headers-only-change follow-up gap).

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { ManifestMcpServer, McpServerAuthType } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "../domain/secret-value-resolver.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

type ResolveMcpServerAuthOutcome =
  | {
      readonly ok: true;
      readonly authType?: McpServerAuthType;
      readonly authConfig?: Record<string, unknown>;
    }
  | { readonly ok: false; readonly error: ApplyWriteError };

type ResolveMcpServerHeadersOutcome =
  | { readonly ok: true; readonly headers?: Record<string, string> }
  | { readonly ok: false; readonly error: ApplyWriteError };

async function resolveSecretField(
  secretResolver: ISecretValueResolver | undefined,
  logger: PinoLoggerService,
  tenantId: string,
  mcpServer: ManifestMcpServer,
  fieldLabel: string,
  secretRef: string,
  correlationId: string | undefined
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  if (!secretResolver) {
    const message = `mcpServer '${mcpServer.name}' ${fieldLabel}.secretRef '${secretRef}' declared but no secrets broker resolver is wired`;
    logger.warn(`create: ${message}`);
    return { ok: false, error: message };
  }
  const resolved = await secretResolver.resolve({
    tenantId,
    kind: "mcpServer",
    owner: mcpServer.name,
    secretName: secretRef,
    correlationId,
  });
  if (!resolved.ok) {
    logger.warn(
      `create: mcpServer '${mcpServer.name}' ${fieldLabel}.secretRef '${secretRef}' broker resolution FAILED: ${resolved.error}`
    );
    return { ok: false, error: resolved.error };
  }
  logger.log(
    `create: mcpServer '${mcpServer.name}' resolved ${fieldLabel}.secretRef '${secretRef}' via the broker (value NEVER logged)`
  );
  return { ok: true, value: resolved.value };
}

async function resolveMcpServerAuth(
  secretResolver: ISecretValueResolver | undefined,
  logger: PinoLoggerService,
  tenantId: string,
  mcpServer: ManifestMcpServer,
  correlationId: string | undefined
): Promise<ResolveMcpServerAuthOutcome> {
  const auth = mcpServer.auth;
  if (!auth) {
    return { ok: true };
  }

  const authConfig: Record<string, unknown> = {};

  switch (auth.authType) {
    case "bearer": {
      const resolved = await resolveSecretField(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        "auth.token",
        auth.token.secretRef,
        correlationId
      );
      if (!resolved.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message: resolved.error,
          },
        };
      }
      authConfig.token = resolved.value;
      break;
    }
    case "api-key": {
      const resolved = await resolveSecretField(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        "auth.key",
        auth.key.secretRef,
        correlationId
      );
      if (!resolved.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message: resolved.error,
          },
        };
      }
      authConfig.key = resolved.value;
      if (auth.headerName) {
        authConfig.headerName = auth.headerName;
      }
      break;
    }
    case "basic": {
      const resolvedUser = await resolveSecretField(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        "auth.username",
        auth.username.secretRef,
        correlationId
      );
      if (!resolvedUser.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message: resolvedUser.error,
          },
        };
      }
      const resolvedPass = await resolveSecretField(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        "auth.password",
        auth.password.secretRef,
        correlationId
      );
      if (!resolvedPass.ok) {
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message: resolvedPass.error,
          },
        };
      }
      authConfig.username = resolvedUser.value;
      authConfig.password = resolvedPass.value;
      break;
    }
  }

  return { ok: true, authType: auth.authType, authConfig };
}

async function resolveMcpServerHeaders(
  secretResolver: ISecretValueResolver | undefined,
  logger: PinoLoggerService,
  tenantId: string,
  mcpServer: ManifestMcpServer,
  correlationId: string | undefined
): Promise<ResolveMcpServerHeadersOutcome> {
  const declaredHeaders = mcpServer.headers;
  if (!declaredHeaders || Object.keys(declaredHeaders).length === 0) {
    return { ok: true };
  }

  const headers: Record<string, string> = {};
  for (const [headerName, value] of Object.entries(declaredHeaders)) {
    if (typeof value === "string") {
      headers[headerName] = value;
      continue;
    }
    const resolved = await resolveSecretField(
      secretResolver,
      logger,
      tenantId,
      mcpServer,
      `headers.${headerName}`,
      value.secretRef,
      correlationId
    );
    if (!resolved.ok) {
      return {
        ok: false,
        error: {
          kind: "secret_not_resolvable",
          resourceKind: "mcpServer",
          resourceName: mcpServer.name,
          message: resolved.error,
        },
      };
    }
    headers[headerName] = resolved.value;
  }
  return { ok: true, headers };
}

function buildMcpServerBody(
  mcpServer: ManifestMcpServer,
  authResolution: Extract<ResolveMcpServerAuthOutcome, { ok: true }>,
  headersResolution: Extract<ResolveMcpServerHeadersOutcome, { ok: true }>
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: mcpServer.name,
    transport_type: mcpServer.transport_type,
    url: mcpServer.url,
  };
  if (mcpServer.description !== undefined) {
    body.description = mcpServer.description;
  }
  if (mcpServer.enabled !== undefined) {
    body.enabled = mcpServer.enabled;
  }
  if (mcpServer.scope !== undefined) {
    body.scope = mcpServer.scope;
  }
  if (headersResolution.headers !== undefined) {
    body.headers = headersResolution.headers;
  }
  if (authResolution.authType !== undefined) {
    body.authType = authResolution.authType;
    body.authConfig = authResolution.authConfig;
  }
  return body;
}

export function createMcpServersWriter(
  baseUrl: string,
  secretResolver?: ISecretValueResolver
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.mcp-server-writer");

  return {
    async create(
      tenantId,
      resourceUnknown,
      context
    ): Promise<CreateOrUpdateResult> {
      const mcpServer = resourceUnknown as ManifestMcpServer;

      const authResolution = await resolveMcpServerAuth(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        context?.correlationId
      );
      if (!authResolution.ok) {
        return authResolution;
      }

      const headersResolution = await resolveMcpServerHeaders(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        context?.correlationId
      );
      if (!headersResolution.ok) {
        return headersResolution;
      }

      const body = buildMcpServerBody(
        mcpServer,
        authResolution,
        headersResolution
      );
      const url = `${baseUrl}/admin/mcp-servers`;
      logger.log(
        `create: POST ${url} mcpServer='${mcpServer.name}' transport_type='${mcpServer.transport_type}' tenant='${tenantId}'` +
          (mcpServer.auth ? ` authType='${mcpServer.auth.authType}'` : "")
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "POST",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
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
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message,
          },
        };
      }

      let created: { id: string };
      try {
        created = (await response.json()) as { id: string };
      } catch (cause) {
        const message = `invalid JSON from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message,
          },
        };
      }

      logger.log(
        `create: mcpServer '${mcpServer.name}' created -> externalId='${created.id}'`
      );
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown,
      _diff,
      context
    ): Promise<CreateOrUpdateResult> {
      const mcpServer = resourceUnknown as ManifestMcpServer;

      const authResolution = await resolveMcpServerAuth(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        context?.correlationId
      );
      if (!authResolution.ok) {
        return authResolution;
      }

      const headersResolution = await resolveMcpServerHeaders(
        secretResolver,
        logger,
        tenantId,
        mcpServer,
        context?.correlationId
      );
      if (!headersResolution.ok) {
        return headersResolution;
      }

      const body = buildMcpServerBody(
        mcpServer,
        authResolution,
        headersResolution
      );
      const url = `${baseUrl}/admin/mcp-servers/${externalId}`;
      logger.log(
        `update: PATCH ${url} mcpServer='${mcpServer.name}' tenant='${tenantId}'`
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "PATCH",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`update: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`update: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "mcpServer",
            resourceName: mcpServer.name,
            message,
          },
        };
      }

      logger.log(
        `update: mcpServer '${mcpServer.name}' updated -> externalId='${externalId}'`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
