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
// manual-loops/provisioning-manifest-gaps.md T06, gap 6 ALSO resolves
// `enabledMcpServerRefs` — but via a SEPARATE, dedicated
// `PATCH /admin/agents/:id/mcp-servers` call AFTER the agent itself is
// created, using the manifest NAMES directly, never an id lookup. This is
// deliberately NOT the generic symbolic-ref id-substitution mechanism (T03):
// agent-admin/agent-ai-service's own `enabled_mcp_servers`/`ns` field is
// keyed by MCP server NAME (`tool-bridge.service.ts` filters
// `McpClientService.getConnectedServers()`, which only ever returns names —
// see the regression test in `tool-bridge.service.spec.ts` fixing a real bug
// where admin-console previously saved this field by id, silently dropping
// every MCP tool for agents with an explicit allowlist). Substituting these
// refs to a real externalId here would reintroduce that exact bug, so
// `manifest.schema.ts`'s `agentSchema.enabledMcpServerRefs` stays outside
// `substitution-allowlist.ts` and this writer passes the plain names
// straight through.
//
// manual-loops/provisioning-manifest-gaps-2.md T04, gap 4 ALSO resolves
// `enabledMcpTools`/`toolDescriptionOverrides` — two MORE separate, dedicated
// PATCH calls (`PATCH /admin/agents/:id/mcp-tools`,
// `PATCH /admin/agents/:id/tool-descriptions`), called AFTER
// `reconcileEnabledMcpServers` above (mirrors `mcp-connections/src/setup.ts`'s
// stage 5 call order: agent upsert -> per-tool MCP enablement -> description
// overrides; the sample never calls the server-enablement PATCH at all,
// meaning per-tool enablement has no functional dependency on an explicit
// `enabledMcpServerRefs` allowlist — a `null` server-enablement default
// already means "all servers", so the ordering here is a documentation/
// call-order convention, not a hard runtime requirement). Same NAME-keying
// as `enabledMcpServerRefs` (decision 6) — neither field is substituted to an
// id, ever.
//
// `updateToolDescriptionOverrides` is gated server-side by
// `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` (default off, see
// `mcp-connections/src/setup.ts`'s own comment); a disabled flag is a valid
// platform state — mirrored here as a skip-and-warn, not a failure, exactly
// like the sample.
//
// Update: `agentComparable` (T03) was existence-only for
// `system_prompt`/`model_config`/KB links, and stays so — no faithful
// mapping yet. T04 makes `enabledMcpTools`/`toolDescriptionOverrides`
// faithfully comparable (agent-admin-service's `IAgent` round-trips both),
// so an agent `update` verdict is reachable. Because the comparable only
// projects those two tool fields, an `update` is only ever TRIGGERED by them
// — but an operator can legitimately change `enabledMcpServerRefs` AND the
// tool fields in the SAME apply, and the enablement change must not be
// silently dropped. So `update()` reconciles ALL THREE
// manifest-declared-name-keyed fields (enabledMcpServerRefs, then
// enabledMcpTools, then toolDescriptionOverrides), using the SAME
// declared-on-the-manifest gate `create()` uses, in the SAME order — no
// asymmetry between the two write paths. `system_prompt`/`model_config`/KB
// links remain write-once-at-create (unchanged T03/T06 limitation, since
// they are not comparable and thus never reach `update()` by themselves).
const AGENT_MCP_TOOLS_PATH = "mcp-tools";
const AGENT_TOOL_DESCRIPTIONS_PATH = "tool-descriptions";

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { Agent } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";
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

/**
 * `PATCH /admin/agents/:id/mcp-servers` — sets the agent's enabled MCP
 * servers by NAME (never id, see this file's header comment). Called AFTER
 * the agent itself is created/resolved; `enabledMcpServerRefs` names are
 * used verbatim as `enabled_mcp_servers` (agent-admin's own field name).
 */
async function reconcileEnabledMcpServers(
  baseUrl: string,
  logger: PinoLoggerService,
  tenantId: string,
  agentName: string,
  externalId: string,
  enabledMcpServerRefs: readonly string[]
): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
  const url = `${baseUrl}/admin/agents/${externalId}/mcp-servers`;
  logger.log(
    `create: PATCH ${url} agent='${agentName}' enabled_mcp_servers=[${enabledMcpServerRefs.join(",")}] tenant='${tenantId}'`
  );

  let response: Response;
  try {
    response = await tracedFetch(url, {
      method: "PATCH",
      headers: {
        [TENANT_HEADER]: tenantId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled_mcp_servers: enabledMcpServerRefs }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = `network failure calling ${url} for agent '${agentName}': ${cause instanceof Error ? cause.message : String(cause)}`;
    logger.warn(`create: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: agentName,
        message,
      },
    };
  }

  if (!response.ok) {
    const message = `HTTP ${String(response.status)} from ${url} for agent '${agentName}'`;
    logger.warn(`create: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: agentName,
        message,
      },
    };
  }

  logger.log(
    `create: agent '${agentName}' enabled_mcp_servers reconciled -> [${enabledMcpServerRefs.join(",")}]`
  );
  return { ok: true };
}

/**
 * `PATCH /admin/agents/:id/mcp-tools` (T04, gap 4) — per-tool MCP allowlist,
 * keyed by MCP server NAME (never id, see this file's header comment). The
 * write is expected to succeed and persist unconditionally; the
 * `AGENT_MCP_TOOL_FILTERING_ENABLED` flag only gates whether the filter is
 * APPLIED at runtime, not whether it can be saved (mirrors
 * `mcp-connections/src/setup.ts`'s own comment on this exact call).
 */
async function reconcileEnabledMcpTools(
  baseUrl: string,
  logger: PinoLoggerService,
  tenantId: string,
  callSite: "create" | "update",
  agentName: string,
  externalId: string,
  enabledMcpTools: Readonly<Record<string, readonly string[] | null>>
): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
  const url = `${baseUrl}/admin/agents/${externalId}/${AGENT_MCP_TOOLS_PATH}`;
  logger.log(
    `${callSite}: PATCH ${url} agent='${agentName}' enabled_mcp_tools servers=[${Object.keys(enabledMcpTools).join(",")}] tenant='${tenantId}'`
  );

  let response: Response;
  try {
    response = await tracedFetch(url, {
      method: "PATCH",
      headers: {
        [TENANT_HEADER]: tenantId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled_mcp_tools: enabledMcpTools }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = `network failure calling ${url} for agent '${agentName}': ${cause instanceof Error ? cause.message : String(cause)}`;
    logger.warn(`${callSite}: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: agentName,
        message,
      },
    };
  }

  if (!response.ok) {
    const message = `HTTP ${String(response.status)} from ${url} for agent '${agentName}'`;
    logger.warn(`${callSite}: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: agentName,
        message,
      },
    };
  }

  logger.log(
    `${callSite}: agent '${agentName}' enabled_mcp_tools reconciled for servers=[${Object.keys(enabledMcpTools).join(",")}]`
  );
  return { ok: true };
}

/**
 * `PATCH /admin/agents/:id/tool-descriptions` (T04, gap 4). Gated server-side
 * by `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` (default off) — a disabled
 * flag surfaces as `HTTP 400` from agent-admin-service's
 * `updateToolDescriptionOverrides` (see `agents.service.ts`) and is a VALID
 * platform state, so it is logged and skipped, not returned as a failure.
 * Any OTHER non-2xx status (network failure, 5xx, etc.) still fails loud —
 * only the documented feature-flag-off shape is swallowed.
 */
async function reconcileToolDescriptionOverrides(
  baseUrl: string,
  logger: PinoLoggerService,
  tenantId: string,
  callSite: "create" | "update",
  agentName: string,
  externalId: string,
  toolDescriptionOverrides: Readonly<Record<string, string>>
): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
  const url = `${baseUrl}/admin/agents/${externalId}/${AGENT_TOOL_DESCRIPTIONS_PATH}`;
  logger.log(
    `${callSite}: PATCH ${url} agent='${agentName}' tool_description_overrides keys=[${Object.keys(toolDescriptionOverrides).join(",")}] tenant='${tenantId}'`
  );

  let response: Response;
  try {
    response = await tracedFetch(url, {
      method: "PATCH",
      headers: {
        [TENANT_HEADER]: tenantId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tool_description_overrides: toolDescriptionOverrides,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = `network failure calling ${url} for agent '${agentName}': ${cause instanceof Error ? cause.message : String(cause)}`;
    logger.warn(`${callSite}: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: agentName,
        message,
      },
    };
  }

  if (response.status === 400) {
    logger.warn(
      `${callSite}: tool_description_overrides skipped for agent '${agentName}' — agent-admin-service returned HTTP 400 (requires AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED=true), a valid platform state`
    );
    return { ok: true };
  }

  if (!response.ok) {
    const message = `HTTP ${String(response.status)} from ${url} for agent '${agentName}'`;
    logger.warn(`${callSite}: ${message}`);
    return {
      ok: false,
      error: {
        kind: "downstream_error",
        resourceKind: "agent",
        resourceName: agentName,
        message,
      },
    };
  }

  logger.log(
    `${callSite}: agent '${agentName}' tool_description_overrides reconciled -> keys=[${Object.keys(toolDescriptionOverrides).join(",")}]`
  );
  return { ok: true };
}

/**
 * Calls the two T04 per-tool PATCH endpoints for whichever fields the
 * manifest actually declares (create-or-update, no prune — fields absent
 * from the manifest leave live state alone, per this loop's decision 2).
 * Shared by both `create()` (after `reconcileEnabledMcpServers`) and
 * `update()` (T04 upgrades `agentComparable` to comparable for exactly these
 * two fields, see this file's header comment).
 */
async function reconcileAgentToolFields(
  baseUrl: string,
  logger: PinoLoggerService,
  tenantId: string,
  callSite: "create" | "update",
  agentName: string,
  externalId: string,
  agent: Agent
): Promise<{ ok: true } | { ok: false; error: ApplyWriteError }> {
  if (agent.enabledMcpTools !== undefined) {
    const toolsResult = await reconcileEnabledMcpTools(
      baseUrl,
      logger,
      tenantId,
      callSite,
      agentName,
      externalId,
      agent.enabledMcpTools
    );
    if (!toolsResult.ok) {
      return toolsResult;
    }
  }

  if (agent.toolDescriptionOverrides !== undefined) {
    const overridesResult = await reconcileToolDescriptionOverrides(
      baseUrl,
      logger,
      tenantId,
      callSite,
      agentName,
      externalId,
      agent.toolDescriptionOverrides
    );
    if (!overridesResult.ok) {
      return overridesResult;
    }
  }

  return { ok: true };
}

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

      if (agent.enabledMcpServerRefs) {
        const reconciled = await reconcileEnabledMcpServers(
          baseUrl,
          logger,
          tenantId,
          agent.name,
          created.id,
          agent.enabledMcpServerRefs
        );
        if (!reconciled.ok) {
          return reconciled;
        }
      }

      // T04, gap 4 — called AFTER enabledMcpServerRefs reconciliation above,
      // mirroring `mcp-connections/src/setup.ts`'s stage 5 call order (see
      // this file's header comment for why this is a convention, not a hard
      // dependency).
      const toolFieldsReconciled = await reconcileAgentToolFields(
        baseUrl,
        logger,
        tenantId,
        "create",
        agent.name,
        created.id,
        agent
      );
      if (!toolFieldsReconciled.ok) {
        return toolFieldsReconciled;
      }

      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown
    ): Promise<CreateOrUpdateResult> {
      const agent = resourceUnknown as Agent;
      logger.log(
        `update: agent '${agent.name}' — system_prompt/model_config/knowledge-base links stay existence-only (no faithful mapping); reconciling manifest-declared enabledMcpServerRefs/enabledMcpTools/toolDescriptionOverrides (T04/T06 name-keyed fields)`
      );

      // Mirror create()'s order and declared-gate exactly: an operator can
      // change enabledMcpServerRefs AND the tool fields in one apply, and the
      // enablement change must never be silently dropped just because the
      // comparable only projects the tool fields.
      if (agent.enabledMcpServerRefs !== undefined) {
        const reconciled = await reconcileEnabledMcpServers(
          baseUrl,
          logger,
          tenantId,
          agent.name,
          externalId,
          agent.enabledMcpServerRefs
        );
        if (!reconciled.ok) {
          return reconciled;
        }
      }

      const toolFieldsReconciled = await reconcileAgentToolFields(
        baseUrl,
        logger,
        tenantId,
        "update",
        agent.name,
        externalId,
        agent
      );
      if (!toolFieldsReconciled.ok) {
        return toolFieldsReconciled;
      }

      return { ok: true, value: { externalId } };
    },
  };
}
