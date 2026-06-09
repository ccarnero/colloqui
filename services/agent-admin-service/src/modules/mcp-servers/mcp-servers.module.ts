import { Module } from "@nestjs/common";
import { agentAdminServiceConfig } from "../../config";
import { MCP_SERVERS_REPOSITORY } from "./mcp-servers.repository.interface";
import { McpServersPostgresRepository } from "./mcp-servers.postgres.repository";
import { McpServersMongoRepository } from "./mcp-servers.mongo.repository";
import { McpServersService } from "./mcp-servers.service";
import { McpServersController } from "./mcp-servers.controller";

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
    McpServersService,
  ],
  exports: [McpServersService],
})
export class McpServersModule {}
