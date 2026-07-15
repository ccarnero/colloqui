// `IPlatformResourceWriter` for agent-admin-service's `POST /admin/agents`.
//
// The manifest's `Agent.profile` is a free-form record; T04 passes through
// the fields `CreateAgentDto` recognizes (description/system_prompt/
// model_config/tools/channels/input_variables/output_variables) verbatim —
// none of them are secret-bearing.
//
// T06 resolves `knowledgeBaseRefs` (manifest KB names) to agent-admin
// `knowledge_base_ids` via `context.knowledgeBaseExternalIds` (the map the
// KB reconciler produces BEFORE `applyManifestPlan` runs — see
// `kb.interfaces.ts`). When the context isn't wired at all (back-compat: the
// T04-era call sites that construct writers directly without T06's DI), the
// old T04 behavior is preserved — log and create without knowledge_base_ids
// rather than fabricating a mapping or failing loud for callers that never
// asked for KB support in the first place.
//
// Update: `agentComparable` (T03) is existence-only — never produces an
// `update` verdict, so this is a defensive no-op stub.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { Agent } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
  WriterContext,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;
const PASSTHROUGH_PROFILE_KEYS = [
  "description",
  "system_prompt",
  "model_config",
  "tools",
  "channels",
  "input_variables",
  "output_variables",
] as const;

export function createAgentsWriter(baseUrl: string): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.agent-writer");

  return {
    async create(
      tenantId,
      resourceUnknown,
      context?: WriterContext
    ): Promise<CreateOrUpdateResult> {
      const agent = resourceUnknown as Agent;

      const body: Record<string, unknown> = { name: agent.name };
      for (const key of PASSTHROUGH_PROFILE_KEYS) {
        if (agent.profile[key] !== undefined) {
          body[key] = agent.profile[key];
        }
      }

      if (agent.knowledgeBaseRefs && agent.knowledgeBaseRefs.length > 0) {
        if (context?.knowledgeBaseExternalIds) {
          const resolved: string[] = [];
          for (const ref of agent.knowledgeBaseRefs) {
            const externalId = context.knowledgeBaseExternalIds.get(ref);
            if (!externalId) {
              const message = `agent '${agent.name}' references unresolved knowledgeBaseRef '${ref}' — the KB reconciler did not produce an externalId for it`;
              logger.warn(`create: ${message}`);
              return {
                ok: false,
                error: {
                  kind: "missing_required_field",
                  resourceKind: "agent",
                  resourceName: agent.name,
                  message,
                },
              };
            }
            resolved.push(externalId);
          }
          logger.log(
            `create: agent '${agent.name}' resolved knowledgeBaseRefs=[${agent.knowledgeBaseRefs.join(",")}] -> knowledge_base_ids=[${resolved.join(",")}]`
          );
          body.knowledge_base_ids = resolved;
        } else {
          logger.log(
            `create: agent '${agent.name}' declares knowledgeBaseRefs=[${agent.knowledgeBaseRefs.join(",")}] but no KB reconciler context was supplied — creating without knowledge_base_ids`
          );
        }
      }

      const url = `${baseUrl}/admin/agents`;
      logger.log(
        `create: POST ${url} agent='${agent.name}' tenant='${tenantId}'`
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
            resourceKind: "agent",
            resourceName: agent.name,
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
            resourceKind: "agent",
            resourceName: agent.name,
            message,
          },
        };
      }

      const created = (await response.json()) as { id: string };
      logger.log(
        `create: agent '${agent.name}' created -> externalId='${created.id}'`
      );
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      _tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const agent = resourceUnknown as Agent;
      logger.log(
        `update: agent '${agent.name}' is existence-only (no comparable field) — no-op, this path is never exercised by the current planner`
      );
      return { ok: true, value: { externalId } };
    },
  };
}
