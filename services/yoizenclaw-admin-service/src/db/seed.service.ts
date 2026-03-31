import {
  Injectable,
  Logger,
  Inject,
} from '@nestjs/common';
import { parse } from 'yaml';
import * as fs from 'fs';
import * as path from 'path';
import { TENANT_CONNECTION_MANAGER } from '../providers/provider-tokens';
import type { TenantConnectionManager } from '../providers/tenant-connection-manager';

interface AgentSeed {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'published' | 'archived';
  role: {
    name: string;
    description?: string;
    systemPrompt: string;
    temperature?: number;
    maxTokens?: number;
  };
  rules?: string[];
  responseStyle?: string;
  llm?: {
    provider: string;
    model: string;
    credentialMode?: string;
    credentialId?: string;
  };
  tools?: Array<{
    id: string;
    name: string;
    description?: string;
    endpoint?: string;
    method?: string;
    headers?: Record<string, string>;
    bodyTemplate?: Record<string, unknown>;
    fieldDescriptions?: Record<string, string>;
    enabled?: boolean;
  }>;
  skills?: Array<{
    id: string;
    name: string;
    description?: string;
    enabled?: boolean;
    instructions?: string;
    allowedTools?: string[];
    config?: Record<string, unknown>;
  }>;
}

interface JobSeed {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  agent_id: string;
  schedule: string;
  payload?: Record<string, unknown>;
}

type TenantConnectionManagerPort = Pick<TenantConnectionManager, 'getConnection'>;

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);
  private readonly dataDir: string;

  constructor(
    @Inject(TENANT_CONNECTION_MANAGER)
    private readonly tenantManager: TenantConnectionManagerPort,
  ) {
    this.dataDir = path.join(process.cwd(), 'data');
  }

  /**
   * Ejecuta el seed completo para un tenant.
   * Crea agents y jobs por defecto.
   */
  async runSeed(tenantId: string): Promise<{ agents: number; jobs: number }> {
    this.logger.log(`Running seed for tenant: ${tenantId}`);

    let agentsCreated = 0;
    let jobsCreated = 0;

    try {
      // Seed Agents
      const agentSeeds = this.loadAgentSeeds();
      for (const seed of agentSeeds) {
        const created = await this.upsertAgent(tenantId, seed);
        if (created) agentsCreated++;
      }

      // Seed Jobs
      const jobSeeds = this.loadJobSeeds();
      for (const seed of jobSeeds) {
        const created = await this.upsertJob(tenantId, seed);
        if (created) jobsCreated++;
      }

      this.logger.log(
        `Seed completed for tenant ${tenantId}: ${agentsCreated} agents, ${jobsCreated} jobs`,
      );

      return { agents: agentsCreated, jobs: jobsCreated };
    } catch (error) {
      this.logger.error(`Failed to run seed for tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Carga todos los agent seeds desde archivos YAML.
   */
  private loadAgentSeeds(): AgentSeed[] {
    const agentsDir = path.join(this.dataDir, 'agents');
    if (!fs.existsSync(agentsDir)) {
      this.logger.warn(`Agents directory not found: ${agentsDir}`);
      return [];
    }

    const seeds: AgentSeed[] = [];

    const files = fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith('.yaml') && !fs.statSync(path.join(agentsDir, f)).isDirectory());

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
        const parsed = parse(content) as AgentSeed;
        if (parsed && parsed.id) {
          seeds.push(parsed);
          this.logger.debug(`Loaded agent seed: ${parsed.id}`);
        }
      } catch (error) {
        this.logger.error(`Failed to parse agent seed ${file}:`, error);
      }
    }

    return seeds;
  }

  /**
   * Carga todos los job seeds desde jobs.yaml.
   */
  private loadJobSeeds(): JobSeed[] {
    const jobsFile = path.join(this.dataDir, 'jobs.yaml');
    if (!fs.existsSync(jobsFile)) {
      this.logger.warn(`Jobs file not found: ${jobsFile}`);
      return [];
    }

    try {
      const content = fs.readFileSync(jobsFile, 'utf8');
      const parsed = parse(content) as { jobs?: JobSeed[] };
      if (parsed && Array.isArray(parsed.jobs)) {
        this.logger.debug(`Loaded ${parsed.jobs.length} job seeds`);
        return parsed.jobs;
      }
    } catch (error) {
      this.logger.error(`Failed to parse jobs.yaml:`, error);
    }

    return [];
  }

  /**
   * Crea o actualiza un agent en la base de datos.
   */
  private async upsertAgent(tenantId: string, seed: AgentSeed): Promise<boolean> {
    const sql = this.tenantManager.getConnection(tenantId);
    const now = new Date().toISOString();

    try {
      // Check if agent exists
      const existing = await sql`SELECT id FROM agents WHERE id = ${seed.id}`;

      const agentData = {
        id: seed.id,
        name: seed.name,
        description: seed.description || null,
        system_prompt: seed.role.systemPrompt,
        model_config: JSON.stringify({
          provider: seed.llm?.provider || 'openai',
          model: seed.llm?.model || 'gpt-4o-mini',
          temperature: seed.role.temperature || 0.7,
          max_tokens: seed.role.maxTokens || 1000,
        }),
        tools: JSON.stringify(seed.tools || []),
        channels: '[]',
        status: seed.status,
        is_active: true,
        published_at: seed.status === 'published' ? now : null,
        created_at: now,
        updated_at: now,
      };

      if (existing.length > 0) {
        // Update existing
        await sql`
          UPDATE agents SET
            name = ${agentData.name},
            description = ${agentData.description},
            system_prompt = ${agentData.system_prompt},
            model_config = ${agentData.model_config}::jsonb,
            tools = ${agentData.tools}::jsonb,
            status = ${agentData.status},
            updated_at = ${agentData.updated_at}
          WHERE id = ${seed.id}
        `;
        this.logger.log(`Updated agent: ${seed.id}`);
        return false;
      } else {
        // Create new
        await sql`
          INSERT INTO agents (
            id, name, description, system_prompt, model_config, tools, channels,
            status, is_active, published_at, created_at, updated_at
          ) VALUES (
            ${agentData.id}, ${agentData.name}, ${agentData.description},
            ${agentData.system_prompt}, ${agentData.model_config}::jsonb,
            ${agentData.tools}::jsonb, ${agentData.channels}::jsonb,
            ${agentData.status}, ${agentData.is_active}, ${agentData.published_at},
            ${agentData.created_at}, ${agentData.updated_at}
          )
        `;
        this.logger.log(`Created agent: ${seed.id}`);
        return true;
      }
    } catch (error) {
      this.logger.error(`Failed to upsert agent ${seed.id}:`, error);
      throw error;
    }
  }

  /**
   * Crea o actualiza un job en la base de datos.
   */
  private async upsertJob(tenantId: string, seed: JobSeed): Promise<boolean> {
    const sql = this.tenantManager.getConnection(tenantId);
    const now = new Date().toISOString();

    try {
      // Check if job exists
      const existing = await sql`SELECT id FROM jobs WHERE id = ${seed.id}`;

      // Calculate next_run based on schedule
      let nextRun: string | null = null;
      if (seed.schedule.startsWith('interval:')) {
        const seconds = parseInt(seed.schedule.split(':')[1], 10);
        nextRun = new Date(Date.now() + seconds * 1000).toISOString();
      }

      const jobData = {
        id: seed.id,
        name: seed.name,
        description: seed.description || null,
        agent_id: seed.agent_id,
        schedule: seed.schedule,
        payload: JSON.stringify(seed.payload || {}),
        is_active: seed.enabled,
        last_run: null,
        next_run: nextRun,
        created_at: now,
        updated_at: now,
      };

      if (existing.length > 0) {
        // Update existing
        await sql`
          UPDATE jobs SET
            name = ${jobData.name},
            description = ${jobData.description},
            agent_id = ${jobData.agent_id},
            schedule = ${jobData.schedule},
            payload = ${jobData.payload}::jsonb,
            is_active = ${jobData.is_active},
            next_run = ${jobData.next_run},
            updated_at = ${jobData.updated_at}
          WHERE id = ${seed.id}
        `;
        this.logger.log(`Updated job: ${seed.id}`);
        return false;
      } else {
        // Create new
        await sql`
          INSERT INTO jobs (
            id, name, description, agent_id, schedule, payload,
            is_active, last_run, next_run, created_at, updated_at
          ) VALUES (
            ${jobData.id}, ${jobData.name}, ${jobData.description},
            ${jobData.agent_id}, ${jobData.schedule}, ${jobData.payload}::jsonb,
            ${jobData.is_active}, ${jobData.last_run}, ${jobData.next_run},
            ${jobData.created_at}, ${jobData.updated_at}
          )
        `;
        this.logger.log(`Created job: ${seed.id}`);
        return true;
      }
    } catch (error) {
      this.logger.error(`Failed to upsert job ${seed.id}:`, error);
      throw error;
    }
  }
}
