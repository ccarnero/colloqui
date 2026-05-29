export const AGENTS_REPOSITORY = Symbol("AGENTS_REPOSITORY");

export interface IAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: Record<string, unknown>;
  tools: unknown[];
  channels: unknown[];
  status: "draft" | "published" | "archived";
  is_active: boolean;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateAgentData {
  name: string;
  description?: string;
  system_prompt: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  channels?: unknown[];
}

export interface IUpdateAgentData {
  name?: string;
  description?: string;
  system_prompt?: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  channels?: unknown[];
  status?: "draft" | "published" | "archived";
  is_active?: boolean;
}

export interface IFindAllAgentsOptions {
  status?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface IAgentsRepository {
  findAll(
    tenantId: string,
    options?: IFindAllAgentsOptions,
  ): Promise<{ agents: IAgent[]; total: number }>;
  findById(tenantId: string, id: string): Promise<IAgent | null>;
  create(tenantId: string, data: ICreateAgentData): Promise<IAgent>;
  update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData,
  ): Promise<IAgent | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  publish(tenantId: string, id: string): Promise<IAgent | null>;
  unpublish(tenantId: string, id: string): Promise<IAgent | null>;
}
