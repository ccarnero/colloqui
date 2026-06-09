import { Injectable, Logger } from "@nestjs/common";
import { tool, jsonSchema } from "ai";
import type { Tool } from "ai";
import { ToolRegistryService } from "./tool-registry.service";
import { ToolExecutorService } from "./tool-executor.service";
import { AdapterExecutorService } from "./adapter-executor.service";
import { McpClientService } from "./mcp-client.service";
import type { ToolDef, ToolExecutionContext, AdapterReference } from "./tool-definition";
import { agentAiServiceConfig } from "../../config";

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
    private readonly mcpClient: McpClientService,
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
   * @param toolDescriptionOverrides Optional per-tool description overrides keyed by tool name.
   */
  async toAiSdkToolsForAgent(
    agentTools: readonly unknown[],
    state: ToolExecutionContext,
    enabledTools?: readonly (string | null | undefined)[] | null,
    enabledMcpServers?: readonly (string | null | undefined)[] | null,
    toolDescriptionOverrides?: Record<string, string> | null,
  ): Promise<Record<string, AiSdkTool>> {
    const tools: Record<string, AiSdkTool> = {};
    const enabledSet =
      enabledTools != null
        ? new Set(enabledTools.filter((n): n is string => typeof n === "string"))
        : null;

    const overridesEnabled =
      agentAiServiceConfig.toolDescriptionOverridesEnabled &&
      toolDescriptionOverrides != null;

    for (const raw of agentTools) {
      const def = this.parseToolDef(raw);
      if (!def) continue;

      // If an allowlist is set, skip tools not in the list
      if (enabledSet !== null && !enabledSet.has(def.name)) continue;

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
          `Tool '${def.name}' has no execution path (no builtin, no adapterRef) — skipped`,
        );
      }
    }

    const allowedMcpServers = enabledMcpServers != null
      ? new Set(enabledMcpServers.filter((id): id is string => typeof id === 'string'))
      : null;

    return this.mergeMcpTools(tools, allowedMcpServers);
  }

  /**
   * Convert all registered tools to AI SDK tool definitions.
   * @param state Runtime state passed to execute functions (tenantId, agentId, etc.)
   * @returns Record<string, Tool> suitable for generateText({ tools })
   */
  async toAiSdkTools(state: ToolExecutionContext): Promise<Record<string, AiSdkTool>> {
    const definitions = this.registry.listTools();
    const tools: Record<string, AiSdkTool> = {};

    for (const def of definitions) {
      tools[def.name] = this.toAiSdkTool(def, state);
    }

    return this.mergeMcpTools(tools);
  }

  /**
   * Convert a subset of tools by name.
   */
  async toAiSdkToolsByName(
    toolNames: readonly string[],
    state: ToolExecutionContext,
  ): Promise<Record<string, AiSdkTool>> {
    const tools: Record<string, AiSdkTool> = {};
    for (const name of toolNames) {
      const def = this.registry.getToolDefinition(name);
      if (def) {
        tools[name] = this.toAiSdkTool(def, state);
      }
    }
    return this.mergeMcpTools(tools);
  }

  /**
   * Returns MCP tools merged with the provided tool set.
   * MCP tools are fetched from connected MCP servers and added to the tools record.
   * Agent-defined tools take precedence over MCP tools (no overwriting).
   *
   * @param allowedMcpServers Optional set of server names to include. null = all connected servers.
   */
  private async mergeMcpTools(
    tools: Record<string, AiSdkTool>,
    allowedMcpServers?: Set<string> | null,
  ): Promise<Record<string, AiSdkTool>> {
    try {
      const connectedServers = this.mcpClient.getConnectedServers();

      for (const serverName of connectedServers) {
        // If we have a filter, skip servers not in the allowlist
        if (allowedMcpServers != null && allowedMcpServers.size > 0 && !allowedMcpServers.has(serverName)) {
          continue;
        }

        const serverTools = await this.mcpClient.getTools(serverName);
        for (const [toolName, toolDef] of Object.entries(serverTools)) {
          if (!tools[toolName]) {
            tools[toolName] = toolDef as AiSdkTool;
            this.logger.debug(`Merged MCP tool '${toolName}' from server '${serverName}'`);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to merge MCP tools: ${error}`);
    }

    return tools;
  }

  private toAiSdkTool(
    def: ToolDef,
    state: ToolExecutionContext,
    opts?: { descriptionOverride?: string },
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
    opts?: { descriptionOverride?: string },
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
          },
        );
        if (!result.success) {
          throw new Error(
            result.error ?? `Adapter tool '${def.name}' failed`,
          );
        }
        return result.output;
      },
    }) as AiSdkTool;
  }

  private parseToolDef(raw: unknown): ToolDef | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name !== "string" || !obj.name) return null;

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
      inputSchema: (typeof (obj.inputSchema ?? obj.parameters) === "object" && (obj.inputSchema ?? obj.parameters) !== null)
        ? (obj.inputSchema ?? obj.parameters) as Record<string, unknown>
        : { type: "object", properties: {} },
      adapterRef,
      builtin: obj.builtin === true || obj.source_type === "builtin",
      readOnly: obj.readOnly === true,
      maxOutputChars: typeof obj.maxOutputChars === "number" ? obj.maxOutputChars : undefined,
    };
  }
}
