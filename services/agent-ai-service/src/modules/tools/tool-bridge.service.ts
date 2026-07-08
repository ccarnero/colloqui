import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { reportMcpUsageEvent } from "@yoizen/shared";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import { agentAiServiceConfig } from "../../config";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { AdapterExecutorService } from "./adapter-executor.service";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { McpClientService, withTimeout } from "./mcp-client.service";
import type {
  AdapterReference,
  ToolDef,
  ToolExecutionContext,
} from "./tool-definition";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { ToolExecutorService } from "./tool-executor.service";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { ToolRegistryService } from "./tool-registry.service";

/** Tool with execute produced by this bridge */
type AiSdkTool = Tool & {
  execute: (args: any, options: any) => PromiseLike<unknown>;
};

/**
 * Bridges internal ToolDef definitions to AI SDK tool() definitions.
 * Produces tools WITH execute functions, enabling multi-step agent loops.
 */
@Injectable()
export class ToolBridgeService {
  private readonly logger = new Logger(ToolBridgeService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly executor: ToolExecutorService,
    private readonly adapterExecutor: AdapterExecutorService,
    private readonly mcpClient: McpClientService
  ) {}

  /**
   * Convert agent's declared tools to AI SDK format.
   * This is the PRIMARY method — reads from agent.tools (DB config),
   * falls back to global registry for builtins.
   *
   * @param agentTools Tool definitions from the agent config
   * @param state Runtime state (tenantId, agentId, etc.)
   * @param enabledTools Optional allowlist of tool names.  null/undefined = all enabled.
   * @param enabledMcpServers Optional allowlist of MCP server names.  null/undefined = all connected MCP servers.
   * @param toolDescriptionOverrides Optional per-tool description overrides keyed by tool name (adapter/builtin) or `"<serverName>:<toolName>"` (MCP).
   * @param enabledMcpTools Optional per-tool MCP allowlist keyed by server name (mcp-connections.md §4).  A `null`/missing server key = all tools from that server.  Only applied when the `mcpToolFilteringEnabled` flag is on.  Kept as the trailing param so pre-Phase-4 positional callers are unaffected.
   */
  async toAiSdkToolsForAgent(
    agentTools: readonly unknown[],
    state: ToolExecutionContext,
    enabledTools?: readonly (string | null | undefined)[] | null,
    enabledMcpServers?: readonly (string | null | undefined)[] | null,
    toolDescriptionOverrides?: Record<string, string> | null,
    enabledMcpTools?: Record<string, string[] | null> | null
  ): Promise<Record<string, AiSdkTool>> {
    const tools: Record<string, AiSdkTool> = {};
    const enabledSet =
      enabledTools != null
        ? new Set(
            enabledTools.filter((n): n is string => typeof n === "string")
          )
        : null;

    const overridesEnabled =
      agentAiServiceConfig.toolDescriptionOverridesEnabled &&
      toolDescriptionOverrides != null;

    for (const raw of agentTools) {
      const def = this.parseToolDef(raw);
      if (!def) {
        continue;
      }

      // If an allowlist is set, skip tools not in the list
      if (enabledSet !== null && !enabledSet.has(def.name)) {
        continue;
      }

      if (def.builtin || this.registry.hasTool(def.name)) {
        const registered = this.registry.getTool(def.name);
        if (registered) {
          const override = overridesEnabled
            ? toolDescriptionOverrides[def.name]
            : undefined;
          tools[def.name] = this.toAiSdkTool(registered.definition, state, {
            descriptionOverride: override,
          });
        }
      } else if (def.adapterRef) {
        const override = overridesEnabled
          ? toolDescriptionOverrides[def.name]
          : undefined;
        tools[def.name] = this.toAdapterTool(def, state, {
          descriptionOverride: override,
        });
      } else {
        this.logger.warn(
          `Tool '${def.name}' has no execution path (no builtin, no adapterRef) — skipped`
        );
      }
    }

    const allowedMcpServers =
      enabledMcpServers != null
        ? new Set(
            enabledMcpServers.filter(
              (id): id is string => typeof id === "string"
            )
          )
        : null;

    return this.mergeMcpTools(
      tools,
      state,
      allowedMcpServers,
      enabledMcpTools,
      toolDescriptionOverrides
    );
  }

  /**
   * Convert all registered tools to AI SDK tool definitions.
   * @param state Runtime state passed to execute functions (tenantId, agentId, etc.)
   * @returns Record<string, Tool> suitable for generateText({ tools })
   */
  async toAiSdkTools(
    state: ToolExecutionContext
  ): Promise<Record<string, AiSdkTool>> {
    const definitions = this.registry.listTools();
    const tools: Record<string, AiSdkTool> = {};

    for (const def of definitions) {
      tools[def.name] = this.toAiSdkTool(def, state);
    }

    return this.mergeMcpTools(tools, state);
  }

  /**
   * Convert a subset of tools by name.
   */
  async toAiSdkToolsByName(
    toolNames: readonly string[],
    state: ToolExecutionContext
  ): Promise<Record<string, AiSdkTool>> {
    const tools: Record<string, AiSdkTool> = {};
    for (const name of toolNames) {
      const def = this.registry.getToolDefinition(name);
      if (def) {
        tools[name] = this.toAiSdkTool(def, state);
      }
    }
    return this.mergeMcpTools(tools, state);
  }

  /**
   * Returns MCP tools merged with the provided tool set.
   * MCP tools are fetched from connected MCP servers and added to the tools record.
   * Agent-defined tools take precedence over MCP tools (no overwriting).
   *
   * Each merged MCP tool's `execute` is wrapped so a completed call reports a
   * usage event (mcp-connections.md §3) — MCP tools come pre-shaped with
   * their own `execute` from `@ai-sdk/mcp` (unlike adapter/builtin tools,
   * which route through this class's own `toAiSdkTool`/`toAdapterTool`), so
   * this is the only interception point available for MCP call usage.
   *
   * When `mcpToolFilteringEnabled` (mcp-connections.md §4) is on, each merged
   * MCP tool is keyed by a namespaced `"<serverName>:<toolName>"` name, filtered
   * by the agent's `enabledMcpTools` per-server allowlist, and eligible for a
   * namespaced description override. When the flag is off, behavior is
   * unchanged from before Phase 4: raw `toolName` keys, no per-tool filter, no
   * override. Usage logging (§3) wraps every merged tool in both modes.
   *
   * @param state Runtime context — carries `tenantId` for the usage event.
   * @param allowedMcpServers Optional set of server names to include. null = all connected servers.
   * @param enabledMcpTools Optional per-server tool allowlist keyed by server name. Only honored when the filtering flag is on.
   * @param toolDescriptionOverrides Optional per-tool description overrides. MCP keys are namespaced (`"<serverName>:<toolName>"`). Only honored when both the filtering flag and `toolDescriptionOverridesEnabled` are on.
   */
  private async mergeMcpTools(
    tools: Record<string, AiSdkTool>,
    state: ToolExecutionContext,
    allowedMcpServers?: Set<string> | null,
    enabledMcpTools?: Record<string, string[] | null> | null,
    toolDescriptionOverrides?: Record<string, string> | null
  ): Promise<Record<string, AiSdkTool>> {
    const filteringEnabled = agentAiServiceConfig.mcpToolFilteringEnabled;
    const overridesEnabled =
      filteringEnabled &&
      agentAiServiceConfig.toolDescriptionOverridesEnabled &&
      toolDescriptionOverrides != null;

    try {
      const connectedServers = this.mcpClient.getConnectedServers();

      for (const serverName of connectedServers) {
        // If we have a filter, skip servers not in the allowlist
        if (
          allowedMcpServers != null &&
          allowedMcpServers.size > 0 &&
          !allowedMcpServers.has(serverName)
        ) {
          continue;
        }

        // Per-server tool allowlist (§4). `null`/missing = all tools enabled.
        // Only applied when the filtering flag is on (backward compatible).
        const perServerAllow =
          filteringEnabled && enabledMcpTools != null
            ? enabledMcpTools[serverName]
            : undefined;
        const perServerAllowSet = Array.isArray(perServerAllow)
          ? new Set(perServerAllow)
          : null;

        const serverTools = await this.mcpClient.getTools(serverName);
        for (const [toolName, toolDef] of Object.entries(serverTools)) {
          // Per-tool filter: when an explicit allowlist exists for this
          // server, skip tools not in it.
          if (perServerAllowSet !== null && !perServerAllowSet.has(toolName)) {
            continue;
          }

          const key = filteringEnabled ? `${serverName}:${toolName}` : toolName;

          // Agent-defined tools take precedence over MCP tools (no overwriting).
          if (tools[key]) {
            continue;
          }

          let merged = this.withMcpUsageLogging(
            toolDef as AiSdkTool,
            state,
            serverName,
            toolName
          );

          if (overridesEnabled) {
            const override = toolDescriptionOverrides?.[key];
            if (typeof override === "string" && override.length > 0) {
              merged = { ...merged, description: override } as AiSdkTool;
            }
          }

          tools[key] = merged;
          this.logger.debug(
            `Merged MCP tool '${key}' from server '${serverName}'`
          );
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to merge MCP tools: ${error}`);
    }

    return tools;
  }

  /**
   * Wraps an MCP tool's own `execute` to report a fire-and-forget usage
   * event after each call, without altering its success/failure behavior
   * towards the LLM (mcp-connections.md §3). Failures reporting usage never
   * affect the tool call's own result — see `reportMcpUsageEvent`'s
   * "failures never propagate" contract.
   */
  private withMcpUsageLogging(
    toolDef: AiSdkTool,
    state: ToolExecutionContext,
    serverName: string,
    toolName: string
  ): AiSdkTool {
    const originalExecute = toolDef.execute.bind(toolDef);
    const mcpServerId = this.mcpClient.getServerId(serverName);

    return {
      ...toolDef,
      execute: async (args: unknown, options: unknown) => {
        const start = Date.now();
        // One idempotency key per call attempt (metering-foundation.md G4) —
        // generated here, at the point the call is measured, so a client-side
        // retry inside reportMcpUsageEvent resends the same key rather than
        // minting a new one.
        const eventId = randomUUID();
        try {
          const result = await withTimeout(
            originalExecute(args, options),
            agentAiServiceConfig.mcpLiveCallTimeoutMs,
            `MCP tool '${serverName}:${toolName}'`
          );
          reportMcpUsageEvent(agentAiServiceConfig.agentAdminServiceUrl, {
            eventId,
            tenantId: state.tenantId,
            mcpServerId,
            serverName,
            toolName,
            success: true,
            durationMs: Date.now() - start,
            correlationId: state.conversationId,
            executionId: state.executionId,
          });
          return result;
        } catch (error) {
          reportMcpUsageEvent(agentAiServiceConfig.agentAdminServiceUrl, {
            eventId,
            tenantId: state.tenantId,
            mcpServerId,
            serverName,
            toolName,
            success: false,
            durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
            correlationId: state.conversationId,
            executionId: state.executionId,
          });
          throw error;
        }
      },
    } as AiSdkTool;
  }

  private toAiSdkTool(
    def: ToolDef,
    state: ToolExecutionContext,
    opts?: { descriptionOverride?: string }
  ): AiSdkTool {
    const parameters = jsonSchema(def.inputSchema);

    return tool({
      description: opts?.descriptionOverride ?? def.description,
      inputSchema: parameters,
      execute: async (args: unknown) => {
        const params = args as Record<string, unknown>;
        const result = await this.executor.executeTool(def.name, params, state);
        if (!result.success) {
          throw new Error(result.error ?? `Tool '${def.name}' failed`);
        }
        return result.output;
      },
    }) as AiSdkTool;
  }

  private toAdapterTool(
    def: ToolDef,
    state: ToolExecutionContext,
    opts?: { descriptionOverride?: string }
  ): AiSdkTool {
    const parameters = jsonSchema(def.inputSchema);

    return tool({
      description: opts?.descriptionOverride ?? def.description,
      inputSchema: parameters,
      execute: async (args: unknown) => {
        const result = await this.adapterExecutor.execute(
          state.tenantId,
          def.adapterRef!,
          args as Record<string, unknown>,
          {
            tenantId: state.tenantId,
            agentId: state.agentId,
            executionId: state.executionId,
          }
        );
        if (!result.success) {
          throw new Error(result.error ?? `Adapter tool '${def.name}' failed`);
        }
        return result.output;
      },
    }) as AiSdkTool;
  }

  private parseToolDef(raw: unknown): ToolDef | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name !== "string" || !obj.name) {
      return null;
    }

    // Handle adapterRef in both camelCase and snake_case
    let adapterRef: AdapterReference | undefined;
    const rawRef = obj.adapterRef ?? obj.adapter_ref;
    if (typeof rawRef === "object" && rawRef !== null) {
      const ref = rawRef as Record<string, unknown>;
      adapterRef = {
        adapterId: String(ref.adapterId ?? ref.adapter_id ?? ""),
        endpointId: String(ref.endpointId ?? ref.endpoint_id ?? ""),
      };
    }

    return {
      name: obj.name,
      description: typeof obj.description === "string" ? obj.description : "",
      inputSchema:
        typeof (obj.inputSchema ?? obj.parameters) === "object" &&
        (obj.inputSchema ?? obj.parameters) !== null
          ? ((obj.inputSchema ?? obj.parameters) as Record<string, unknown>)
          : { type: "object", properties: {} },
      adapterRef,
      builtin: obj.builtin === true || obj.source_type === "builtin",
      readOnly: obj.readOnly === true,
      maxOutputChars:
        typeof obj.maxOutputChars === "number" ? obj.maxOutputChars : undefined,
    };
  }
}
