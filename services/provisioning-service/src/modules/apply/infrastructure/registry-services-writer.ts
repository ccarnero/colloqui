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

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { HostedService } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

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
      logger.log(
        `create: POST ${url} service='${service.name}' image='${service.image}' tenant='${tenantId}'`
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
      logger.log(
        `update: PATCH ${url} service='${service.name}' tenant='${tenantId}'`
      );

      try {
        const response = await tracedFetch(url, {
          method: "PATCH",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify({ envVars: {} }),
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

      return { ok: true, value: { externalId } };
    },
  };
}
