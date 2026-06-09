import type { InjectionToken } from "@nestjs/common";
import type { VariableDeclaration } from "@yoizen/shared";

export const AGENT_CONFIG_REPOSITORY: InjectionToken = "AGENT_CONFIG_REPOSITORY";

/**
 * Agent configuration read from per-tenant database.
 * Only published agents should be loaded by the AI service.
 */
export interface IAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly systemPrompt: string;
  readonly modelConfig: Record<string, unknown>;
  readonly tools: unknown[];
  readonly enabledTools: readonly string[] | null;
  readonly enabledMcpServers: readonly string[] | null;
  readonly skills: unknown[];
  readonly rules: unknown[];
  readonly channels: unknown[];
  readonly inputVariables: VariableDeclaration[];
  readonly outputVariables: VariableDeclaration[];
  readonly knowledgeBaseIds: string[];
  readonly status: "draft" | "published" | "archived";
  readonly isActive: boolean;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Read-only repository for agent configurations.
 *
 * The AI service only reads agents — writes happen in admin-service.
 * We only care about published, active agents.
 */
export interface IAgentConfigRepository {
  findById(tenantId: string, agentId: string): Promise<IAgentConfig | null>;
  findAll(tenantId: string): Promise<IAgentConfig[]>;
  findByTenant(
    tenantId: string,
    options?: { status?: string },
  ): Promise<IAgentConfig[]>;
}
