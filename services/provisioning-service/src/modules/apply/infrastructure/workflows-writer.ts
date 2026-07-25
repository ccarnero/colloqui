// `IPlatformResourceWriter` for workflow-service's `POST /workflows` /
// `PUT /workflows/:id`.
//
// The manifest's `Workflow.definition` is an opaque record (SPEC: its steps
// may embed channelRef/agentRef/serviceRef/secretRef/connectorRef at any
// depth, walked by the structural-rule validators, not this writer). T04
// reads `definition.application`/`definition.actions`/`definition.trigger`/
// `definition.variables` straight off it — the exact shape
// `workflow-service`'s `CreateWorkflowDto`/`UpdateWorkflowDto` expect — and
// fails loud with a typed error if the required fields are missing, rather
// than fabricating a default `application` or an empty `actions` array.
//
// PRECONDITION (manual-loops/provisioning-manifest-gaps.md T03, gap 3): by
// the time `resourceUnknown.definition` reaches this writer, EVERY
// allowlisted symbolic ref inside it (`plan/lib/substitution-allowlist.ts` —
// `accountId`/`adapterId`/`agentId`/`serviceId`/`serverId`/`connectorId`)
// has already been replaced with the real platform id by
// `apply-manifest.ts`'s substitution pass (`build-substituted-resource.ts` /
// `plan/lib/substitute-symbolic-refs.ts`), which runs on a WORKING COPY and
// never touches the stored manifest. This writer still never
// inspects/walks the definition for refs itself — it only forwards
// whatever `definition` it is handed, opaque record in, opaque record out.
//
// Update (manual-loops/provisioning-manifest-gaps-5.md): `workflowComparable`
// is now CONTENT-AWARE (`plan/lib/comparable-fields.ts`) — a workflow whose
// `application`/`actions`/`trigger`/`variables` diverge from the live
// resource now produces a real `update` verdict, so this can no longer be a
// safe no-op stub (it would otherwise silently lie about reconciling the
// workflow). `update()` sends the SAME body shape `create()` does to
// `PUT /workflows/:id` — workflow-service's `UpdateWorkflowDto` requires
// `name`/`application`/`actions`, `trigger`/`variables` optional, mirroring
// `CreateWorkflowDto` exactly — and fails loud on a non-2xx response, same
// posture as `create()`.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { Workflow } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

/** Builds the `{name, application, actions, trigger?, variables?}` body BOTH
 * `create()` and `update()` send — the exact shape workflow-service's
 * `CreateWorkflowDto`/`UpdateWorkflowDto` expect. Returns a typed
 * `missing_required_field` error instead of the body when `application`/
 * `actions` are absent, so both callers fail loud identically. */
function buildWorkflowBody(workflow: Workflow):
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  const definition = workflow.definition;

  const application =
    typeof definition.application === "string" &&
    definition.application.length > 0
      ? definition.application
      : undefined;
  if (!application) {
    return {
      ok: false,
      message: `workflow '${workflow.name}' is missing required field definition.application (non-empty string)`,
    };
  }

  const actions = Array.isArray(definition.actions)
    ? definition.actions
    : undefined;
  if (!actions || actions.length === 0) {
    return {
      ok: false,
      message: `workflow '${workflow.name}' is missing required field definition.actions (non-empty array)`,
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
  return { ok: true, body };
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createWorkflowsWriter(
  baseUrl: string
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.workflow-writer");

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const workflow = resourceUnknown as Workflow;

      const built = buildWorkflowBody(workflow);
      if (!built.ok) {
        logger.warn(`create: ${built.message}`);
        return {
          ok: false,
          error: {
            kind: "missing_required_field",
            resourceKind: "workflow",
            resourceName: workflow.name,
            message: built.message,
          },
        };
      }
      const body = built.body;

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
      tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const workflow = resourceUnknown as Workflow;

      const built = buildWorkflowBody(workflow);
      if (!built.ok) {
        logger.warn(`update: ${built.message}`);
        return {
          ok: false,
          error: {
            kind: "missing_required_field",
            resourceKind: "workflow",
            resourceName: workflow.name,
            message: built.message,
          },
        };
      }
      const body = built.body;

      const url = `${baseUrl}/workflows/${externalId}`;
      logger.log(
        `update: PUT ${url} workflow='${workflow.name}' tenant='${tenantId}'`
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "PUT",
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
            resourceKind: "workflow",
            resourceName: workflow.name,
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
            resourceKind: "workflow",
            resourceName: workflow.name,
            message,
          },
        };
      }

      logger.log(
        `update: workflow '${workflow.name}' updated -> externalId='${externalId}'`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
