import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { agentAdminServiceConfig } from "../../config";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { NatsPublisher } from "../../providers/nats.provider";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { AdaptersService } from "../adapters/adapters.service";
import type {
  MemoryProposalActionResponseDto,
  MemoryProposalListResponseDto,
} from "./agents.dto";
import {
  AGENTS_REPOSITORY,
  type IAgent,
  type IAgentsRepository,
  type IAgentVersion,
  type ICreateAgentData,
  type IFindAllAgentsOptions,
  type ISemverPublishContext,
  type IUpdateAgentData,
} from "./agents.repository.interface";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference (emitDecoratorMetadata).
import { AgentsRuntimeService } from "./agents-runtime.service";
import type { BumpType } from "./version-utils";
import {
  computeNextSemver,
  computeSnapshotDiff,
  computeVersionNumber,
  detectBumpType,
} from "./version-utils";

@Injectable()
export class AgentsService {
  private readonly logger = new PinoLoggerService(AgentsService.name);

  constructor(
    @Inject(AGENTS_REPOSITORY)
    private readonly repository: IAgentsRepository,
    private readonly natsPublisher: NatsPublisher,
    private readonly runtimeService: AgentsRuntimeService,
    @Optional() private readonly adaptersService?: AdaptersService,
  ) {}

  async findAll(
    tenantId: string,
    options: IFindAllAgentsOptions = {}
  ): Promise<{ agents: IAgent[]; total: number }> {
    return this.repository.findAll(tenantId, options);
  }

  async findById(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
    await this.validateConnectorRef(tenantId, data.model_config);
    await this.validateAdapterRefs(tenantId, data.tools);
    return this.repository.create(tenantId, data);
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData
  ): Promise<IAgent> {
    await this.validateConnectorRef(tenantId, data.model_config);
    await this.validateAdapterRefs(tenantId, data.tools);
    const agent = await this.repository.update(tenantId, id, data);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async updateEnabledTools(
    tenantId: string,
    id: string,
    enabledTools: string[] | null
  ): Promise<IAgent> {
    const agent = await this.repository.update(tenantId, id, {
      enabled_tools: enabledTools,
    });
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async updateEnabledMcpServers(
    tenantId: string,
    id: string,
    enabledMcpServers: string[] | null
  ): Promise<IAgent> {
    const agent = await this.repository.update(tenantId, id, {
      enabled_mcp_servers: enabledMcpServers,
    });
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async updateEnabledMcpTools(
    tenantId: string,
    id: string,
    enabledMcpTools: Record<string, string[] | null> | null
  ): Promise<IAgent> {
    const agent = await this.repository.update(tenantId, id, {
      enabled_mcp_tools: enabledMcpTools,
    });
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async updateToolDescriptionOverrides(
    tenantId: string,
    id: string,
    overrides: Record<string, string> | null
  ): Promise<IAgent> {
    if (!agentAdminServiceConfig.toolDescriptionOverridesEnabled) {
      throw new BadRequestException(
        "Tool description overrides are not enabled. Set AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED=true to use this feature."
      );
    }
    const agent = await this.repository.update(tenantId, id, {
      tool_description_overrides: overrides,
    });
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
    return agent;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }
  }

  async publish(
    tenantId: string,
    id: string,
    userId?: string
  ): Promise<IAgent> {
    let semverContext: ISemverPublishContext | undefined;

    if (userId) {
      const agent = await this.repository.findById(tenantId, id);
      const versions = (await this.repository.listVersions(tenantId, id)) ?? [];

      let previousSnapshot: Record<string, any> | null = null;
      let currentMajor = 0;
      let currentMinor = 0;
      let currentPatch = 0;

      if (versions.length > 0) {
        const latest = versions[0] as IAgentVersion;
        previousSnapshot = (latest.snapshot ?? {}) as Record<string, any>;
        if (latest.semver_major != null) {
          currentMajor = latest.semver_major;
          currentMinor = latest.semver_minor ?? 0;
          currentPatch = latest.semver_patch ?? 0;
        } else if (latest.version_number != null) {
          // Fallback: decode semver from version_number
          currentMajor = Math.floor(latest.version_number / 10000);
          currentMinor = Math.floor((latest.version_number % 10000) / 100);
          currentPatch = latest.version_number % 100;
        }
      }

      const currentSnapshot: Record<string, any> = agent
        ? {
            name: agent.name,
            description: agent.description,
            system_prompt: agent.system_prompt,
            model_config: agent.model_config,
            tools: agent.tools,
            enabled_tools: agent.enabled_tools,
            enabled_mcp_servers: agent.enabled_mcp_servers,
            enabled_mcp_tools: agent.enabled_mcp_tools,
            tool_description_overrides: agent.tool_description_overrides,
            channels: agent.channels,
            knowledge_base_ids: agent.knowledge_base_ids,
            input_variables: agent.input_variables,
            output_variables: agent.output_variables,
          }
        : {};

      // When previous snapshot is partial, limit current snapshot to only
      // the fields present in the previous snapshot to avoid false-positive
      // bumps from fields that weren't previously tracked.
      if (previousSnapshot && agent) {
        const fullSnapshot = { ...currentSnapshot };
        const limitedSnapshot: Record<string, any> = {};
        for (const key of Object.keys(
          previousSnapshot as Record<string, unknown>
        )) {
          if (key in fullSnapshot) {
            limitedSnapshot[key] = fullSnapshot[key];
          }
        }
        // If previousSnapshot had keys, use the limited snapshot; otherwise keep full
        if (Object.keys(limitedSnapshot).length > 0) {
          Object.assign(currentSnapshot, limitedSnapshot);
          // Remove keys not in previousSnapshot
          for (const key of Object.keys(currentSnapshot)) {
            if (!(key in (previousSnapshot as Record<string, unknown>))) {
              delete currentSnapshot[key];
            }
          }
        }
      }

      const bumpType: BumpType =
        previousSnapshot === null
          ? "major"
          : detectBumpType(previousSnapshot, currentSnapshot);

      const nextSemver = computeNextSemver(
        currentMajor,
        currentMinor,
        currentPatch,
        bumpType
      );
      const diff = computeSnapshotDiff(previousSnapshot, currentSnapshot);
      const versionNumber = computeVersionNumber(
        nextSemver.major,
        nextSemver.minor,
        nextSemver.patch
      );

      semverContext = {
        semver: { ...nextSemver, bumpType },
        publishedBy: userId,
        diff,
        versionNumber,
      };
    }

    const agent = await this.repository.publish(tenantId, id, semverContext);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    try {
      await this.natsPublisher.publishAgentPublished(
        tenantId,
        agent.id,
        agent.name,
        {
          system_prompt: agent.system_prompt,
          model_config: agent.model_config,
          tools: agent.tools,
          channels: agent.channels,
          description: agent.description ?? undefined,
        }
      );
      this.logger.log(`Agent '${agent.name}' published and event emitted`);
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.published event for agent '${agent.id}'`,
        error
      );
    }

    return agent;
  }

  async unpublish(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.unpublish(tenantId, id);
    if (!agent) {
      throw new NotFoundException(`Agent with ID '${id}' not found`);
    }

    try {
      await this.natsPublisher.publishAgentUnpublished(
        tenantId,
        agent.id,
        agent.name
      );
      this.logger.log(`Agent '${agent.name}' unpublished and event emitted`);
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.unpublished event for agent '${agent.id}'`,
        error
      );
    }

    return agent;
  }

  async revertToPublished(tenantId: string, id: string): Promise<IAgent> {
    const agent = await this.repository.revertToPublished(tenantId, id);
    if (!agent) {
      throw new NotFoundException(
        `Agent ${id} not found or has no published version`
      );
    }

    try {
      await this.natsPublisher.publishAgentPublished(
        tenantId,
        agent.id,
        agent.name,
        {
          system_prompt: agent.system_prompt,
          model_config: agent.model_config,
          tools: agent.tools,
          channels: agent.channels,
          description: agent.description ?? undefined,
        }
      );
      this.logger.log(
        `Agent '${agent.name}' reverted to published version and event emitted`
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit agent.reverted event for agent '${agent.id}'`,
        error
      );
    }

    return agent;
  }

  async listVersions(
    tenantId: string,
    agentId: string
  ): Promise<IAgentVersion[]> {
    return this.repository.listVersions(tenantId, agentId);
  }

  async rollbackToVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<IAgent> {
    const agent = await this.repository.rollbackToVersion(
      tenantId,
      agentId,
      versionId
    );
    if (!agent) {
      throw new NotFoundException(
        `Version ${versionId} not found for agent ${agentId}`
      );
    }
    return agent;
  }

  async deleteVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<void> {
    const deleted = await this.repository.deleteVersion(
      tenantId,
      agentId,
      versionId
    );
    if (!deleted) {
      throw new NotFoundException(
        `Version ${versionId} not found for agent ${agentId}`
      );
    }
  }

  async listMemoryProposals(
    tenantId: string
  ): Promise<MemoryProposalListResponseDto> {
    return this.runtimeService.listMemoryProposals(tenantId);
  }

  async approveMemoryProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      "memory_proposals_approve",
      reviewerId
    );
  }

  async rejectMemoryProposal(
    tenantId: string,
    proposalId: string,
    reviewerId?: string
  ): Promise<MemoryProposalActionResponseDto> {
    return this.runtimeService.reviewMemoryProposal(
      tenantId,
      proposalId,
      "memory_proposals_reject",
      reviewerId
    );
  }

  private async validateConnectorRef(
    tenantId: string,
    modelConfig?: Record<string, unknown>
  ): Promise<void> {
    const llm = modelConfig?.llm as Record<string, unknown> | undefined;
    const connectorId = llm?.connectorId as string | undefined;
    if (!connectorId) {
      return;
    }

    const adapter = await this.adaptersService?.findOne(tenantId, connectorId);

    if (!adapter) {
      throw new BadRequestException(
        `connectorId '${connectorId}' does not reference an existing adapter`
      );
    }

    const hasLlmTag = adapter.tags?.includes("llm") ?? false;
    if (!hasLlmTag) {
      throw new BadRequestException(
        `Adapter '${connectorId}' is not tagged as 'llm'`
      );
    }

    if (adapter.status !== "enabled") {
      throw new BadRequestException(
        `Adapter '${connectorId}' is '${adapter.status}'; expected 'enabled'`
      );
    }
  }

  /**
   * When VALIDATE_ADAPTER_REFS is enabled, checks that each tool's
   * adapterRef points to an existing adapter and endpoint.
   */
  private async validateAdapterRefs(
    tenantId: string,
    tools?: unknown[]
  ): Promise<void> {
    if (!agentAdminServiceConfig.validateAdapterRefs || !tools?.length) {
      return;
    }

    for (const tool of tools) {
      const t = tool as Record<string, unknown>;
      const ref = t.adapterRef as
        | { adapterId?: string; endpointId?: string }
        | undefined;
      if (!ref?.adapterId) {
        continue;
      }

      const adapterExists = await this.adaptersService?.adapterExists(
        tenantId,
        ref.adapterId
      );
      if (!adapterExists) {
        this.logger.warn(
          `Tool '${t.name ?? "unnamed"}' references adapter '${ref.adapterId}' which does not exist. ` +
            "Config will be saved but tool execution may fail."
        );
        continue;
      }

      if (ref.endpointId) {
        const epExists = await this.adaptersService?.endpointExists(
          tenantId,
          ref.adapterId,
          ref.endpointId
        );
        if (!epExists) {
          this.logger.warn(
            `Tool '${t.name ?? "unnamed"}' references endpoint '${ref.endpointId}' on adapter '${ref.adapterId}' which does not exist. ` +
              "Config will be saved but tool execution may fail."
          );
        }
      }
    }
  }
}
