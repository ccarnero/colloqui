// `IPlatformResourceWriter` for workflow-service's `POST /workflows`.
//
// The manifest's `Workflow.definition` is an opaque record (SPEC: its steps
// may embed channelRef/agentRef/serviceRef/secretRef at any depth, walked by
// the structural-rule validators, not this writer). T04 reads
// `definition.application`/`definition.actions`/`definition.trigger`/
// `definition.variables` straight off it — the exact shape
// `workflow-service`'s `CreateWorkflowDto` expects — and fails loud with a
// typed error if the required fields are missing, rather than fabricating a
// default `application` or an empty `actions` array.
//
// Update: `workflowComparable` (T03) is existence-only — never produces an
// `update` verdict, so this is a defensive no-op stub.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { Workflow } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

export function createWorkflowsWriter(
  baseUrl: string
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.workflow-writer");

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const workflow = resourceUnknown as Workflow;
      const definition = workflow.definition;

      const application =
        typeof definition.application === "string" &&
        definition.application.length > 0
          ? definition.application
          : undefined;
      if (!application) {
        const message = `workflow '${workflow.name}' is missing required field definition.application (non-empty string)`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "missing_required_field",
            resourceKind: "workflow",
            resourceName: workflow.name,
            message,
          },
        };
      }

      const actions = Array.isArray(definition.actions)
        ? definition.actions
        : undefined;
      if (!actions || actions.length === 0) {
        const message = `workflow '${workflow.name}' is missing required field definition.actions (non-empty array)`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "missing_required_field",
            resourceKind: "workflow",
            resourceName: workflow.name,
            message,
          },
        };
      }

      const body: Record<string, unknown> = {
        name: workflow.name,
        application,
        actions,
      };
      if (definition.trigger !== undefined) {
        body.trigger = definition.trigger;
      }
      if (definition.variables !== undefined) {
        body.variables = definition.variables;
      }

      const url = `${baseUrl}/workflows`;
      logger.log(
        `create: POST ${url} workflow='${workflow.name}' tenant='${tenantId}'`
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
            resourceKind: "workflow",
            resourceName: workflow.name,
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
            resourceKind: "workflow",
            resourceName: workflow.name,
            message,
          },
        };
      }

      const created = (await response.json()) as { id: string };
      logger.log(
        `create: workflow '${workflow.name}' created -> externalId='${created.id}'`
      );
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      _tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const workflow = resourceUnknown as Workflow;
      logger.log(
        `update: workflow '${workflow.name}' is existence-only (no comparable field) — no-op, this path is never exercised by the current planner`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
