// `IPlatformResourceWriter` for agent-admin-service's `POST /admin/agents`.
//
// The manifest's `Agent.profile` is a free-form record; T04 passes through
// the fields `CreateAgentDto` recognizes (description/system_prompt/
// model_config/tools/channels/input_variables/output_variables) verbatim —
// none of them are secret-bearing. `knowledgeBaseRefs` resolution (manifest
// KB names -> agent-admin UUIDs) is explicitly OUT of scope for T04 (lands
// with T06's knowledge-base sources); omitted here, not silently dropped —
// see the comment at the call site.
//
// Update: `agentComparable` (T03) is existence-only — never produces an
// `update` verdict, so this is a defensive no-op stub.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { Agent } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
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
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const agent = resourceUnknown as Agent;

      // T06 will resolve `knowledgeBaseRefs` (manifest KB names) to
      // agent-admin knowledge_base_ids; T04 creates the agent without them
      // rather than fabricating a mapping.
      if (agent.knowledgeBaseRefs && agent.knowledgeBaseRefs.length > 0) {
        logger.log(
          `create: agent '${agent.name}' declares knowledgeBaseRefs=[${agent.knowledgeBaseRefs.join(",")}] — KB ref resolution lands in T06, creating without knowledge_base_ids for now`
        );
      }

      const body: Record<string, unknown> = { name: agent.name };
      for (const key of PASSTHROUGH_PROFILE_KEYS) {
        if (agent.profile[key] !== undefined) {
          body[key] = agent.profile[key];
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
