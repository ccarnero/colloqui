// `IPlatformResourceWriter` for agent-admin-service's
// `POST /admin/system-variables` / `PATCH /admin/system-variables/:id`
// (manual-loops/provisioning-manifest-gaps.md T04, gap 4).
//
// System variables carry NO secretRef wiring — `value` is CONFIG (a
// threshold/flag), not a secret VALUE, so this writer never touches the
// secrets broker (unlike `channels-writer.ts`/`connectors-writer.ts`).
// create-or-update only (decision 2, no prune/delete anywhere in this loop).
//
// `systemVariableComparable` (T04, `comparable-fields.ts`) projects BOTH
// `type` and `value`, so an `update` verdict here always has a mappable
// field — unlike the existence-only kinds (agent/workflow), there is no
// "diff with zero mappable fields" no-op branch to mirror from
// `channels-writer.ts`.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { ManifestSystemVariable } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

export function createSystemVariablesWriter(
  baseUrl: string
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.system-variable-writer");

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const systemVariable = resourceUnknown as ManifestSystemVariable;

      const body: Record<string, unknown> = {
        name: systemVariable.name,
        type: systemVariable.type,
        value: systemVariable.value,
      };
      if (systemVariable.label !== undefined) {
        body.label = systemVariable.label;
      }
      if (systemVariable.description !== undefined) {
        body.description = systemVariable.description;
      }

      const url = `${baseUrl}/admin/system-variables`;
      logger.log(
        `create: POST ${url} systemVariable='${systemVariable.name}' type='${systemVariable.type}' tenant='${tenantId}'`
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
            resourceKind: "systemVariable",
            resourceName: systemVariable.name,
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
            resourceKind: "systemVariable",
            resourceName: systemVariable.name,
            message,
          },
        };
      }

      const created = (await response.json()) as { id: string };
      logger.log(
        `create: systemVariable '${systemVariable.name}' created -> externalId='${created.id}'`
      );
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown,
      diff
    ): Promise<CreateOrUpdateResult> {
      const systemVariable = resourceUnknown as ManifestSystemVariable;
      const mappableFields = new Set(diff.map((d) => d.field));

      if (mappableFields.size === 0) {
        logger.log(
          `update: systemVariable '${systemVariable.name}' diff has no mappable fields — no-op`
        );
        return { ok: true, value: { externalId } };
      }

      const body: Record<string, unknown> = {};
      if (mappableFields.has("type")) {
        body.type = systemVariable.type;
      }
      if (mappableFields.has("value")) {
        body.value = systemVariable.value;
      }

      const url = `${baseUrl}/admin/system-variables/${externalId}`;
      logger.log(
        `update: PATCH ${url} systemVariable='${systemVariable.name}' fields=[${[...mappableFields].join(",")}] tenant='${tenantId}'`
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
            resourceKind: "systemVariable",
            resourceName: systemVariable.name,
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
            resourceKind: "systemVariable",
            resourceName: systemVariable.name,
            message,
          },
        };
      }

      logger.log(
        `update: systemVariable '${systemVariable.name}' updated -> externalId='${externalId}'`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
