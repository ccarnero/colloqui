import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import type { NatsConnection } from "nats";
import {
  AGENT_CONFIG_REPOSITORY,
  type IAgentConfigRepository,
} from "../agents/agent-config.repository.interface";
import { AgentCacheService } from "../agents/agent-cache.service";

interface AgentConfigSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  isActive: boolean;
  modelConfig: Record<string, unknown>;
}

interface RuntimeStatusResponse {
  service: string;
  uptimeSeconds: number;
  natsConnected: boolean;
  cacheSize: number;
  timestamp: string;
}

interface ValidationError {
  field: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const SERVICE_START_TIME = Date.now();

@Controller("admin")
@UseGuards(TenantGuard)
export class AdminController {
  private readonly logger = new PinoLoggerService(AdminController.name);

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY)
    private readonly repository: IAgentConfigRepository,
    private readonly cache: AgentCacheService,
    @Inject(NATS_CONNECTION)
    private readonly natsConnection: NatsConnection,
  ) {}

  @Get("agents")
  async listAgents(
    @TenantId() tenantId: string,
  ): Promise<{ agents: AgentConfigSummary[]; count: number }> {
    const configs = await this.repository.findByTenant(tenantId);

    const agents: AgentConfigSummary[] = configs.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: c.status,
      isActive: c.isActive,
      modelConfig: c.modelConfig,
    }));

    this.logger.debug(
      `Listed ${agents.length} agent configs for tenant '${tenantId}'`,
    );

    return { agents, count: agents.length };
  }

  @Get("agents/:id")
  async getAgent(
    @TenantId() tenantId: string,
    @Param("id") agentId: string,
  ): Promise<{ agent: AgentConfigSummary | null }> {
    const config = await this.repository.findById(tenantId, agentId);
    if (!config) {
      return { agent: null };
    }

    return {
      agent: {
        id: config.id,
        name: config.name,
        description: config.description,
        status: config.status,
        isActive: config.isActive,
        modelConfig: config.modelConfig,
      },
    };
  }

  @Post("agents/validate")
  @HttpCode(HttpStatus.OK)
  validateAgentConfig(
    @Body() config: Record<string, unknown>,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    if (!config.id || typeof config.id !== "string") {
      errors.push({ field: "id", message: "Agent id is required and must be a string" });
    }

    if (!config.name || typeof config.name !== "string") {
      errors.push({ field: "name", message: "Agent name is required and must be a string" });
    }

    if (!config.systemPrompt || typeof config.systemPrompt !== "string") {
      errors.push({ field: "systemPrompt", message: "systemPrompt is required and must be a string" });
    }

    if (config.modelConfig !== undefined && typeof config.modelConfig !== "object") {
      errors.push({ field: "modelConfig", message: "modelConfig must be an object" });
    }

    if (config.tools !== undefined && !Array.isArray(config.tools)) {
      errors.push({ field: "tools", message: "tools must be an array" });
    }

    if (config.skills !== undefined && !Array.isArray(config.skills)) {
      errors.push({ field: "skills", message: "skills must be an array" });
    }

    if (config.rules !== undefined && !Array.isArray(config.rules)) {
      errors.push({ field: "rules", message: "rules must be an array" });
    }

    if (config.channels !== undefined && !Array.isArray(config.channels)) {
      errors.push({ field: "channels", message: "channels must be an array" });
    }

    return { valid: errors.length === 0, errors };
  }

  @Get("status")
  getStatus(): RuntimeStatusResponse {
    return {
      service: "agent-ai-service",
      uptimeSeconds: Math.floor((Date.now() - SERVICE_START_TIME) / 1000),
      natsConnected: !this.natsConnection.isClosed(),
      cacheSize: this.cache.size,
      timestamp: new Date().toISOString(),
    };
  }
}
