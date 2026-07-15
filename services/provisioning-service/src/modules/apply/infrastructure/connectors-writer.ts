// `IPlatformResourceWriter` for connector-admin's `POST /connectors`.
//
// connector-admin's `CreateAdapterDto` requires a real `baseUrl` — that is
// plain infra wiring (not a credential), so it is read straight off the
// manifest's `config.baseUrl` (never fabricated; missing -> typed error).
// Auth material (`authConfig`) is NEVER set here: a connector with a
// `secretRef` fails loud with `secret_not_resolvable` until the T05 secrets
// broker lands, exactly like the channel writer.
//
// Update: `connectorComparable` (T03) is existence-only — `diffResource`
// with two empty projections never produces an `update` verdict for a
// connector, so this method is a defensive no-op stub, never exercised by
// the current planner.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { Connector } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

export function createConnectorsWriter(
  baseUrl: string
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.connector-writer");

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const connector = resourceUnknown as Connector;

      if (connector.secretRef) {
        const message = `connector '${connector.name}' declares secretRef '${connector.secretRef}' — the secrets broker lands in T05, cannot resolve auth material yet`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "secret_not_resolvable",
            resourceKind: "connector",
            resourceName: connector.name,
            message,
          },
        };
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

      const context =
        typeof config.context === "string" ? config.context : "external";
      const url = `${baseUrl}/connectors`;
      logger.log(
        `create: POST ${url} connector='${connector.name}' tenant='${tenantId}'`
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
            name: connector.name,
            context,
            baseUrl: configBaseUrl,
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
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      _tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const connector = resourceUnknown as Connector;
      logger.log(
        `update: connector '${connector.name}' is existence-only (no comparable field) — no-op, this path is never exercised by the current planner`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
