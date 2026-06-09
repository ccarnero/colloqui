import { Injectable, Logger } from "@nestjs/common";
import type {
  ToolDef,
  RegisteredTool,
  ToolHandler,
  ToolResult,
  ToolExecutionContext,
} from "./tool-definition";

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, RegisteredTool>();

  registerTool(
    definition: ToolDef,
    handler?: ToolHandler,
  ): void {
    if (this.tools.has(definition.name)) {
      this.logger.warn(`Overwriting existing tool: ${definition.name}`);
    }
    this.tools.set(definition.name, { definition, handler });
    this.logger.log(`Registered tool: ${definition.name}`);
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getToolDefinition(name: string): ToolDef | undefined {
    return this.tools.get(name)?.definition;
  }

  listTools(): ToolDef[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  listBuiltinTools(): ToolDef[] {
    return Array.from(this.tools.values())
      .filter((t) => t.definition.builtin === true)
      .map((t) => t.definition);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  async executeBuiltin(
    name: string,
    params: Record<string, unknown>,
    state: ToolExecutionContext,
  ): Promise<ToolResult> {
    const registered = this.tools.get(name);
    if (!registered) {
      return { success: false, output: null, error: `Tool '${name}' not found` };
    }
    if (!registered.handler) {
      return {
        success: false,
        output: null,
        error: `Tool '${name}' has no builtin handler`,
      };
    }
    try {
      return await registered.handler(params, state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Builtin tool '${name}' failed: ${message}`);
      return { success: false, output: null, error: message };
    }
  }

  clear(): void {
    this.tools.clear();
    this.logger.log("Cleared all tools from registry");
  }
}
