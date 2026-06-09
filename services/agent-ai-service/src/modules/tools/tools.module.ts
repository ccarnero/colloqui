import { Module, OnModuleInit } from "@nestjs/common";
import { ToolRegistryService } from "./tool-registry.service";
import { AdapterExecutorService } from "./adapter-executor.service";
import { ToolExecutorService } from "./tool-executor.service";
import { ToolBridgeService } from "./tool-bridge.service";
import { McpClientService } from "./mcp-client.service";
import { McpConnectionService } from "./mcp-connection.service";
import { ToolsController } from "./tools.controller";
import { COMMUNICATE_TOOL_DEF, communicateHandler } from "./builtin-tools/communicate.tool";
import { createMemoryToolDef, createMemoryHandler } from "./builtin-tools/memory.tool";
import { MemoryClientService } from "../memory/memory-client.service";
import { MemoryModule } from "../memory/memory.module";

@Module({
  imports: [MemoryModule],
  controllers: [ToolsController],
  providers: [
    ToolRegistryService,
    AdapterExecutorService,
    ToolExecutorService,
    ToolBridgeService,
    McpClientService,
    McpConnectionService,
  ],
  exports: [ToolRegistryService, ToolExecutorService, AdapterExecutorService, ToolBridgeService, McpClientService, McpConnectionService],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly memoryClient: MemoryClientService,
  ) {}

  onModuleInit(): void {
    this.registry.registerTool(COMMUNICATE_TOOL_DEF, communicateHandler);
    this.registry.registerTool(
      createMemoryToolDef(),
      createMemoryHandler(this.memoryClient),
    );
  }
}
