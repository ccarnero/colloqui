import { Module } from "@nestjs/common";
import { agentAdminServiceConfig } from "../../config";
import { McpServersController } from "./mcp-servers.controller";
import { McpServersMongoRepository } from "./mcp-servers.mongo.repository";
import { McpServersPostgresRepository } from "./mcp-servers.postgres.repository";
import { MCP_SERVERS_REPOSITORY } from "./mcp-servers.repository.interface";
import { McpServersService } from "./mcp-servers.service";
import { McpToolsProbeService } from "./mcp-tools-probe.service";
import { McpUsageMongoRepository } from "./mcp-usage.mongo.repository";
import { McpUsagePostgresRepository } from "./mcp-usage.postgres.repository";
import { MCP_USAGE_REPOSITORY } from "./mcp-usage.repository.interface";

@Module({
  controllers: [McpServersController],
  providers: [
    {
      provide: MCP_SERVERS_REPOSITORY,
      useClass:
        agentAdminServiceConfig.dbEngine === "postgres"
          ? McpServersPostgresRepository
          : McpServersMongoRepository,
    },
    {
      provide: MCP_USAGE_REPOSITORY,
      useClass:
        agentAdminServiceConfig.dbEngine === "postgres"
          ? McpUsagePostgresRepository
          : McpUsageMongoRepository,
    },
    McpServersService,
    McpToolsProbeService,
  ],
  exports: [McpServersService],
})
export class McpServersModule {}
