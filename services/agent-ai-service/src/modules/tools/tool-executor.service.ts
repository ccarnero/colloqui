import { Injectable, Logger } from "@nestjs/common";
import type { ToolResult, ToolExecutionContext } from "./tool-definition";
import { ToolRegistryService } from "./tool-registry.service";
import { AdapterExecutorService } from "./adapter-executor.service";

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly adapterExecutor: AdapterExecutorService,
  ) {}

  async executeTool(
    name: string,
    params: Record<string, unknown>,
    state: ToolExecutionContext,
  ): Promise<ToolResult> {
    const registered = this.registry.getTool(name);
    if (!registered) {
      this.logger.warn(`Tool not found: ${name}`);
      return { success: false, output: null, error: `Tool '${name}' not found` };
    }

    const { definition } = registered;

    if (definition.builtin || registered.handler) {
      this.logger.debug(`Executing builtin tool: ${name}`);
      return this.registry.executeBuiltin(name, params, state);
    }

    if (definition.adapterRef) {
      this.logger.debug(
        `Executing adapter tool: ${name} -> ${definition.adapterRef.adapterId}/${definition.adapterRef.endpointId}`,
      );
      return this.adapterExecutor.execute(
        state.tenantId,
        definition.adapterRef,
        params,
        state,
      );
    }

    this.logger.warn(`Tool '${name}' has no execution path (neither builtin nor adapter)`);
    return {
      success: false,
      output: null,
      error: `Tool '${name}' has no execution path`,
    };
  }
}
