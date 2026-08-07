import { randomUUID } from "node:crypto";
import type {
  IAgent,
  IAgentsRepository,
  IAgentVersion,
  ICreateAgentData,
  IFindAllAgentsOptions,
  ISemverPublishContext,
  IUpdateAgentData,
} from "../../src/modules/agents/agents.repository.interface";
import type {
  IConfigFile,
  IConfigFilesRepository,
  ICreateConfigFileData,
  IFindAllConfigFilesOptions,
  IUpdateConfigFileData,
} from "../../src/modules/config-files/config-files.repository.interface";
import type {
  ICreateExecutionData,
  IFindAllExecutionsOptions,
  IJobExecution,
  IJobExecutionsRepository,
} from "../../src/modules/jobs/job-executions.repository.interface";
import type {
  ICreateJobData,
  IFindAllJobsOptions,
  IJob,
  IJobsRepository,
  IUpdateJobData,
} from "../../src/modules/jobs/jobs.repository.interface";
import { calculateNextRun } from "../../src/modules/jobs/schedule.utils";

/**
 * In-memory persistence fakes for the integration suites.
 *
 * Why they exist
 * --------------
 * The integration suites drive the REAL controllers/services/DTO pipeline but
 * must not require a database. The previous double was a fake "SQL connection"
 * (`{ unsafe: (v) => v, json: JSON.stringify }`) handed to the real Postgres
 * repositories: `sql\`INSERT ...\`` then returned the SQL *string* instead of a
 * row, so every create/read assertion was meaningless once the module built.
 *
 * The seam moved one layer up, to the repository DI tokens
 * (`JOBS_REPOSITORY`, `JOB_EXECUTIONS_REPOSITORY`, `AGENTS_REPOSITORY`,
 * `CONFIG_FILES_REPOSITORY`). That seam is engine-agnostic — it is the same
 * contract `*.postgres.repository.ts` and `*.mongo.repository.ts` implement —
 * so these fakes mirror the OBSERVABLE behaviour of the Postgres repositories:
 * generated ids, column defaults, soft deletes, version bumps, filters,
 * `ORDER BY created_at DESC`, pagination, and the executions -> jobs join.
 *
 * Every read returns a shallow copy of the stored row, so a caller that mutates
 * a response cannot corrupt the store — the same guarantee a real driver gives.
 */

interface ITenantStore<TRow> {
  /** Rows for one tenant. Tenants are isolated, as they are by database. */
  rows(tenantId: string): TRow[];
}

function createTenantStore<TRow>(): ITenantStore<TRow> {
  const byTenant = new Map<string, TRow[]>();

  return {
    rows(tenantId: string): TRow[] {
      const existing = byTenant.get(tenantId);
      if (existing) {
        return existing;
      }
      const created: TRow[] = [];
      byTenant.set(tenantId, created);
      return created;
    },
  };
}

/**
 * `ORDER BY created_at DESC`. `Array.prototype.sort` is stable, so rows sharing
 * a timestamp keep insertion order — Postgres leaves that tie order
 * unspecified, so no assertion may depend on it.
 */
function orderByCreatedAtDesc<TRow extends { created_at: Date }>(
  rows: TRow[]
): TRow[] {
  return [...rows].sort(
    (left, right) => right.created_at.getTime() - left.created_at.getTime()
  );
}

/** `LIMIT`/`OFFSET`, with the same defaults the SQL repositories apply. */
function paginate<TRow>(rows: TRow[], limit = 20, offset = 0): TRow[] {
  return rows.slice(offset, offset + limit);
}

function clone<TRow>(row: TRow): TRow {
  return { ...row };
}

/* -------------------------------------------------------------------------- */
/* jobs + job_executions                                                      */
/* -------------------------------------------------------------------------- */

export interface IInMemoryJobsBackend {
  jobs: IJobsRepository;
  executions: IJobExecutionsRepository;
}

/**
 * Jobs and executions share one backend because the real schema couples them:
 * `job_executions` LEFT JOINs `jobs` for `job_name`, and
 * `JobsPostgresRepository.delete` cascade-deletes a job's executions inside a
 * transaction (there is no `ON DELETE CASCADE` on the FK).
 */
export function createInMemoryJobsBackend(): IInMemoryJobsBackend {
  const jobsStore = createTenantStore<IJob>();
  const executionsStore = createTenantStore<IJobExecution>();

  const findJob = (tenantId: string, id: string): IJob | undefined =>
    jobsStore.rows(tenantId).find((job) => job.id === id);

  const jobs: IJobsRepository = {
    async findAll(
      tenantId: string,
      options: IFindAllJobsOptions = {}
    ): Promise<{ jobs: IJob[]; total: number }> {
      const { agent_id, is_active, limit, offset } = options;

      const matching = jobsStore
        .rows(tenantId)
        .filter((job) => (agent_id ? job.agent_id === agent_id : true))
        .filter((job) =>
          is_active === undefined ? true : job.is_active === is_active
        );

      return {
        jobs: paginate(orderByCreatedAtDesc(matching), limit, offset).map(
          clone
        ),
        total: matching.length,
      };
    },

    async findById(tenantId: string, id: string): Promise<IJob | null> {
      const job = findJob(tenantId, id);
      return job ? clone(job) : null;
    },

    async create(tenantId: string, data: ICreateJobData): Promise<IJob> {
      const now = new Date();
      const job: IJob = {
        id: randomUUID(),
        name: data.name,
        agent_id: data.agent_id,
        schedule: data.schedule,
        payload: data.payload ?? {},
        is_active: data.is_active ?? true,
        last_run: null,
        next_run: calculateNextRun(data.schedule),
        created_at: now,
        updated_at: now,
      };
      jobsStore.rows(tenantId).push(job);
      return clone(job);
    },

    async update(
      tenantId: string,
      id: string,
      data: IUpdateJobData
    ): Promise<IJob | null> {
      const job = findJob(tenantId, id);
      if (!job) {
        return null;
      }

      if (data.name !== undefined) {
        job.name = data.name;
      }
      if (data.agent_id !== undefined) {
        job.agent_id = data.agent_id;
      }
      if (data.schedule !== undefined) {
        job.schedule = data.schedule;
        job.next_run = calculateNextRun(data.schedule);
      }
      if (data.payload !== undefined) {
        job.payload = data.payload;
      }
      if (data.is_active !== undefined) {
        job.is_active = data.is_active;
      }
      job.updated_at = new Date();

      return clone(job);
    },

    async delete(tenantId: string, id: string): Promise<boolean> {
      const rows = jobsStore.rows(tenantId);
      const index = rows.findIndex((job) => job.id === id);
      if (index === -1) {
        return false;
      }

      // Same cascade the real repository performs inside `sql.begin`.
      const executionRows = executionsStore.rows(tenantId);
      for (let i = executionRows.length - 1; i >= 0; i--) {
        if (executionRows[i].job_id === id) {
          executionRows.splice(i, 1);
        }
      }

      rows.splice(index, 1);
      return true;
    },

    async enable(tenantId: string, id: string): Promise<IJob | null> {
      const job = findJob(tenantId, id);
      if (!job) {
        return null;
      }
      job.is_active = true;
      job.updated_at = new Date();
      return clone(job);
    },

    async disable(tenantId: string, id: string): Promise<IJob | null> {
      const job = findJob(tenantId, id);
      if (!job) {
        return null;
      }
      job.is_active = false;
      job.updated_at = new Date();
      return clone(job);
    },

    async updateLastRun(
      tenantId: string,
      id: string,
      schedule: string
    ): Promise<IJob | null> {
      const job = findJob(tenantId, id);
      if (!job) {
        return null;
      }
      const now = new Date();
      job.last_run = now;
      job.next_run = calculateNextRun(schedule, now);
      job.updated_at = now;
      return clone(job);
    },
  };

  const executions: IJobExecutionsRepository = {
    async findAll(
      tenantId: string,
      options: IFindAllExecutionsOptions = {}
    ): Promise<{ executions: IJobExecution[]; total: number }> {
      const { job_id, status, limit, offset } = options;

      const matching = executionsStore
        .rows(tenantId)
        .filter((execution) => (job_id ? execution.job_id === job_id : true))
        .filter((execution) => (status ? execution.status === status : true));

      // `LEFT JOIN jobs j ON e.job_id = j.id` — `job_name` is null when the
      // parent job is gone.
      const joined = paginate(
        orderByCreatedAtDesc(matching),
        limit,
        offset
      ).map((execution) => ({
        ...execution,
        job_name: findJob(tenantId, execution.job_id)?.name,
      }));

      return { executions: joined, total: matching.length };
    },

    async create(
      tenantId: string,
      data: ICreateExecutionData
    ): Promise<IJobExecution> {
      const now = new Date();
      const execution: IJobExecution = {
        id: randomUUID(),
        job_id: data.job_id,
        status: data.status,
        event_payload: data.event_payload ?? {},
        result: null,
        logs: [],
        error_message: null,
        retry_count: 0,
        triggered_by: data.triggered_by ?? "manual",
        started_at: data.status === "running" ? now : null,
        finished_at: null,
        created_at: now,
      };
      executionsStore.rows(tenantId).push(execution);

      // `RETURNING ... NULL::TEXT as job_name` — the INSERT never joins, so the
      // stored row carries no `job_name` either.
      return clone(execution);
    },

    async updateExecutionStatus(
      tenantId: string,
      id: string,
      status: "completed" | "failed",
      result?: Record<string, unknown> | null,
      errorMessage?: string | null
    ): Promise<void> {
      const execution = executionsStore
        .rows(tenantId)
        .find((row) => row.id === id);
      if (!execution) {
        return;
      }

      execution.status = status;
      if (result !== undefined) {
        execution.result = result ?? {};
      }
      execution.error_message = errorMessage ?? null;
      execution.finished_at = new Date();
    },
  };

  return { jobs, executions };
}

/* -------------------------------------------------------------------------- */
/* agents + agent_versions                                                    */
/* -------------------------------------------------------------------------- */

/** Fields `publish` snapshots into `published_config` / `agent_versions`. */
function buildAgentSnapshot(agent: IAgent): Record<string, unknown> {
  return {
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
  };
}

/**
 * Applies a published/version snapshot back onto the draft row — shared by
 * `revertToPublished` and `rollbackToVersion`.
 *
 * Divergence worth knowing: for a snapshot MISSING `name`/`system_prompt` the
 * real `revertToPublished` keeps the current values (mirrored here) while the
 * real `rollbackToVersion` writes `""`. Unreachable in practice — `publish` is
 * the only writer of snapshots and it always records both columns.
 */
function applyAgentSnapshot(
  agent: IAgent,
  snapshot: Record<string, unknown>
): void {
  agent.name = (snapshot.name as string) ?? agent.name;
  agent.description = (snapshot.description as string | null) ?? null;
  agent.system_prompt =
    (snapshot.system_prompt as string) ?? agent.system_prompt;
  agent.model_config = (snapshot.model_config as Record<string, unknown>) ?? {};
  agent.tools = (snapshot.tools as unknown[]) ?? [];
  agent.enabled_tools = (snapshot.enabled_tools as string[] | null) ?? null;
  agent.enabled_mcp_servers =
    (snapshot.enabled_mcp_servers as string[] | null) ?? null;
  agent.enabled_mcp_tools =
    (snapshot.enabled_mcp_tools as Record<string, string[] | null> | null) ??
    null;
  agent.tool_description_overrides =
    (snapshot.tool_description_overrides as Record<string, string> | null) ??
    null;
  agent.channels = (snapshot.channels as unknown[]) ?? [];
  agent.knowledge_base_ids = (snapshot.knowledge_base_ids as string[]) ?? [];
  agent.input_variables = (snapshot.input_variables as unknown[]) ?? [];
  agent.output_variables = (snapshot.output_variables as unknown[]) ?? [];
  agent.updated_at = new Date();
}

export function createInMemoryAgentsRepository(): IAgentsRepository {
  const agentsStore = createTenantStore<IAgent>();
  const versionsStore = createTenantStore<IAgentVersion>();

  /** Every SQL statement in the real repository filters `is_active = true`. */
  const findActive = (tenantId: string, id: string): IAgent | undefined =>
    agentsStore
      .rows(tenantId)
      .find((agent) => agent.id === id && agent.is_active);

  return {
    async findAll(
      tenantId: string,
      options: IFindAllAgentsOptions = {}
    ): Promise<{ agents: IAgent[]; total: number }> {
      const { status, is_active: isActiveFilter, limit, offset } = options;
      /** When omitted, list only active rows (soft-delete default). */
      const isActiveEq = isActiveFilter === undefined ? true : isActiveFilter;

      const matching = agentsStore
        .rows(tenantId)
        .filter((agent) => agent.is_active === isActiveEq)
        .filter((agent) => (status ? agent.status === status : true));

      return {
        agents: paginate(orderByCreatedAtDesc(matching), limit, offset).map(
          clone
        ),
        total: matching.length,
      };
    },

    async findById(tenantId: string, id: string): Promise<IAgent | null> {
      const agent = findActive(tenantId, id);
      return agent ? clone(agent) : null;
    },

    async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
      const now = new Date();
      const agent: IAgent = {
        id: randomUUID(),
        name: data.name,
        description: data.description ?? null,
        system_prompt: data.system_prompt,
        model_config: data.model_config ?? {},
        tools: data.tools ?? [],
        enabled_tools: null,
        enabled_mcp_servers: null,
        enabled_mcp_tools: null,
        tool_description_overrides: null,
        channels: data.channels ?? [],
        knowledge_base_ids: data.knowledge_base_ids ?? [],
        input_variables: data.input_variables ?? [],
        output_variables: data.output_variables ?? [],
        status: "draft",
        is_active: true,
        published_at: null,
        published_config: null,
        published_by: null,
        created_at: now,
        updated_at: now,
      };
      agentsStore.rows(tenantId).push(agent);
      return clone(agent);
    },

    async update(
      tenantId: string,
      id: string,
      data: IUpdateAgentData
    ): Promise<IAgent | null> {
      const agent = findActive(tenantId, id);
      if (!agent) {
        return null;
      }

      // Column by column, like the real repository's one-UPDATE-per-field
      // block: a key outside this list is silently dropped there, so it must
      // be dropped here too.
      if (data.name !== undefined) {
        agent.name = data.name;
      }
      if (data.description !== undefined) {
        agent.description = data.description;
      }
      if (data.system_prompt !== undefined) {
        agent.system_prompt = data.system_prompt;
      }
      if (data.model_config !== undefined) {
        agent.model_config = data.model_config;
      }
      if (data.tools !== undefined) {
        agent.tools = data.tools;
      }
      if (data.enabled_tools !== undefined) {
        agent.enabled_tools = data.enabled_tools;
      }
      if (data.enabled_mcp_servers !== undefined) {
        agent.enabled_mcp_servers = data.enabled_mcp_servers;
      }
      if (data.enabled_mcp_tools !== undefined) {
        agent.enabled_mcp_tools = data.enabled_mcp_tools;
      }
      if (data.tool_description_overrides !== undefined) {
        agent.tool_description_overrides = data.tool_description_overrides;
      }
      if (data.channels !== undefined) {
        agent.channels = data.channels;
      }
      if (data.knowledge_base_ids !== undefined) {
        agent.knowledge_base_ids = data.knowledge_base_ids;
      }
      if (data.input_variables !== undefined) {
        agent.input_variables = data.input_variables;
      }
      if (data.output_variables !== undefined) {
        agent.output_variables = data.output_variables;
      }
      if (data.status !== undefined) {
        agent.status = data.status;
      }
      if (data.is_active !== undefined) {
        agent.is_active = data.is_active;
      }
      agent.updated_at = new Date();

      // The real repository re-SELECTs with `is_active = true`, so an update
      // that deactivates the row returns null.
      const reread = findActive(tenantId, id);
      return reread ? clone(reread) : null;
    },

    /** Soft delete, exactly like `UPDATE agents SET is_active = false`. */
    async delete(tenantId: string, id: string): Promise<boolean> {
      const agent = findActive(tenantId, id);
      if (!agent) {
        return false;
      }
      agent.is_active = false;
      agent.updated_at = new Date();
      return true;
    },

    async publish(
      tenantId: string,
      id: string,
      context?: ISemverPublishContext
    ): Promise<IAgent | null> {
      const agent = findActive(tenantId, id);
      if (!agent) {
        return null;
      }

      const snapshot = buildAgentSnapshot(agent);
      const now = new Date();

      agent.status = "published";
      agent.published_at = now;
      agent.published_config = snapshot;
      if (context?.publishedBy) {
        agent.published_by = context.publishedBy;
      }
      agent.updated_at = now;

      const versions = versionsStore.rows(tenantId);
      const fallbackVersion =
        versions.filter((version) => version.agent_id === id).length + 1;

      versions.push({
        id: randomUUID(),
        agent_id: id,
        version_number: context?.versionNumber ?? fallbackVersion,
        snapshot,
        published_at: now,
        created_at: now,
        semver_major: context?.semver.major,
        semver_minor: context?.semver.minor,
        semver_patch: context?.semver.patch,
        semver_label: context?.semver.label,
        bump_type: context?.semver.bumpType,
        diff: context?.diff,
        published_by: context?.publishedBy,
      });

      return clone(agent);
    },

    async unpublish(tenantId: string, id: string): Promise<IAgent | null> {
      const agent = findActive(tenantId, id);
      if (!agent) {
        return null;
      }
      agent.status = "draft";
      agent.published_at = null;
      agent.updated_at = new Date();
      return clone(agent);
    },

    async revertToPublished(
      tenantId: string,
      id: string
    ): Promise<IAgent | null> {
      const agent = findActive(tenantId, id);
      if (!agent?.published_config) {
        return null;
      }
      applyAgentSnapshot(agent, agent.published_config);
      return clone(agent);
    },

    async listVersions(
      tenantId: string,
      agentId: string
    ): Promise<IAgentVersion[]> {
      return versionsStore
        .rows(tenantId)
        .filter((version) => version.agent_id === agentId)
        .sort((left, right) => right.version_number - left.version_number)
        .map(clone);
    },

    async rollbackToVersion(
      tenantId: string,
      agentId: string,
      versionId: string
    ): Promise<IAgent | null> {
      const version = versionsStore
        .rows(tenantId)
        .find(
          (candidate) =>
            candidate.id === versionId && candidate.agent_id === agentId
        );
      if (!version) {
        return null;
      }

      const agent = findActive(tenantId, agentId);
      if (!agent) {
        return null;
      }

      applyAgentSnapshot(agent, version.snapshot);
      return clone(agent);
    },

    async deleteVersion(
      tenantId: string,
      agentId: string,
      versionId: string
    ): Promise<boolean> {
      const versions = versionsStore.rows(tenantId);
      const index = versions.findIndex(
        (version) => version.id === versionId && version.agent_id === agentId
      );
      if (index === -1) {
        return false;
      }
      versions.splice(index, 1);
      return true;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* config_files                                                               */
/* -------------------------------------------------------------------------- */

export function createInMemoryConfigFilesRepository(): IConfigFilesRepository {
  const filesStore = createTenantStore<IConfigFile>();

  const findActiveByPath = (
    tenantId: string,
    path: string
  ): IConfigFile | undefined =>
    filesStore
      .rows(tenantId)
      .find((file) => file.path === path && file.is_active);

  return {
    async findAll(
      tenantId: string,
      options: IFindAllConfigFilesOptions = {}
    ): Promise<{ files: IConfigFile[]; total: number }> {
      const { limit, offset } = options;
      const matching = filesStore
        .rows(tenantId)
        .filter((file) => file.is_active);

      return {
        files: paginate(orderByCreatedAtDesc(matching), limit, offset).map(
          clone
        ),
        total: matching.length,
      };
    },

    async findByPath(
      tenantId: string,
      path: string
    ): Promise<IConfigFile | null> {
      const file = findActiveByPath(tenantId, path);
      return file ? clone(file) : null;
    },

    async create(
      tenantId: string,
      data: ICreateConfigFileData
    ): Promise<IConfigFile> {
      const now = new Date();
      const file: IConfigFile = {
        id: randomUUID(),
        name: data.name,
        path: data.path,
        content: data.content,
        format: data.format,
        version: 1,
        is_active: true,
        created_at: now,
        updated_at: now,
      };
      filesStore.rows(tenantId).push(file);
      return clone(file);
    },

    /** `SET updated_at = NOW(), version = version + 1, ...` */
    async update(
      tenantId: string,
      path: string,
      data: IUpdateConfigFileData
    ): Promise<IConfigFile | null> {
      const file = findActiveByPath(tenantId, path);
      if (!file) {
        return null;
      }

      file.version += 1;
      if (data.name !== undefined) {
        file.name = data.name;
      }
      if (data.content !== undefined) {
        file.content = data.content;
      }
      if (data.is_active !== undefined) {
        file.is_active = data.is_active;
      }
      file.updated_at = new Date();

      return clone(file);
    },

    async findAllActive(tenantId: string): Promise<IConfigFile[]> {
      return filesStore
        .rows(tenantId)
        .filter((file) => file.is_active)
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(clone);
    },
  };
}
