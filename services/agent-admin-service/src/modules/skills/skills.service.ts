import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { JsonValue } from "@yoizen/shared";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { NatsPublisher } from "../../providers/nats.provider";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

export interface ISkillFile {
  name: string;
  path: string;
  type: "script" | "reference" | "asset";
  content: string;
}

export interface ISkill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  color: string;
  trigger_commands: string[];
  when_to_use: string;
  priority: number;
  allowed_tools: string[];
  mode: string;
  files: ISkillFile[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateSkillData {
  name: string;
  description?: string;
  system_prompt: string;
  icon?: string;
  color?: string;
  trigger_commands?: string[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: string;
  files?: ISkillFile[];
}

export interface IUpdateSkillData {
  name?: string;
  description?: string;
  system_prompt?: string;
  icon?: string;
  color?: string;
  trigger_commands?: string[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: string;
  files?: ISkillFile[];
  is_active?: boolean;
}

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
    private readonly natsPublisher: NatsPublisher,
  ) {}

  async findAll(
    tenantId: string
  ): Promise<{ skills: ISkill[]; total: number }> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const skills = await sql<ISkill[]>`
      SELECT *
      FROM skills
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY name
    `;
    return { skills, total: skills.length };
  }

  async findById(tenantId: string, id: string): Promise<ISkill | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [skill] = await sql<ISkill[]>`
      SELECT *
      FROM skills
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;
    return skill ?? null;
  }

  async create(tenantId: string, data: ICreateSkillData): Promise<ISkill> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const id = randomUUID();

    const [skill] = await sql<ISkill[]>`
      INSERT INTO skills (
        id,
        tenant_id,
        name,
        description,
        system_prompt,
        icon,
        color,
        trigger_commands,
        when_to_use,
        priority,
        allowed_tools,
        mode,
        files
      ) VALUES (
        ${id},
        ${tenantId},
        ${data.name},
        ${data.description ?? ""},
        ${data.system_prompt},
        ${data.icon ?? "smart_toy"},
        ${data.color ?? "#42a5f5"},
        ${sql.array(data.trigger_commands ?? [])},
        ${data.when_to_use ?? ""},
        ${data.priority ?? 0},
        ${sql.array(data.allowed_tools ?? [])},
        ${data.mode ?? "llm_driven"},
        ${sql.json((data.files ?? []) as unknown as JsonValue)}
      )
      RETURNING *
    `;

    this.natsPublisher
      .publishSkillChanged(tenantId, skill.id, "created", { name: skill.name })
      .catch((err) =>
        this.logger.warn("NATS publish failed on skill create", err)
      );

    return skill;
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateSkillData
  ): Promise<ISkill | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    // Build dynamic SET clause by composing fragments (same convention as
    // config-files.postgres.repository.ts and jobs.postgres.repository.ts).
    // postgres.js fragments carry internal parameterization state; joining
    // them with Array.prototype.join() stringifies each fragment via
    // .toString() and loses that state, producing invalid/unparameterized
    // SQL. Nesting fragments via `sql\`${setClause}, col = ${value}\`` keeps
    // every parameter correctly bound.
    let setClause = sql`updated_at = NOW()`;

    if (data.name !== undefined) {
      setClause = sql`${setClause}, name = ${data.name}`;
    }
    if (data.description !== undefined) {
      setClause = sql`${setClause}, description = ${data.description}`;
    }
    if (data.system_prompt !== undefined) {
      setClause = sql`${setClause}, system_prompt = ${data.system_prompt}`;
    }
    if (data.icon !== undefined) {
      setClause = sql`${setClause}, icon = ${data.icon}`;
    }
    if (data.color !== undefined) {
      setClause = sql`${setClause}, color = ${data.color}`;
    }
    if (data.trigger_commands !== undefined) {
      setClause = sql`${setClause}, trigger_commands = ${sql.array(data.trigger_commands)}`;
    }
    if (data.when_to_use !== undefined) {
      setClause = sql`${setClause}, when_to_use = ${data.when_to_use}`;
    }
    if (data.priority !== undefined) {
      setClause = sql`${setClause}, priority = ${data.priority}`;
    }
    if (data.allowed_tools !== undefined) {
      setClause = sql`${setClause}, allowed_tools = ${sql.array(data.allowed_tools)}`;
    }
    if (data.mode !== undefined) {
      setClause = sql`${setClause}, mode = ${data.mode}`;
    }
    if (data.files !== undefined) {
      setClause = sql`${setClause}, files = ${sql.json((data.files ?? []) as unknown as JsonValue)}`;
    }
    if (data.is_active !== undefined) {
      setClause = sql`${setClause}, is_active = ${data.is_active}`;
    }

    const [skill] = await sql<ISkill[]>`
      UPDATE skills
      SET ${setClause}
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;

    if (skill) {
      this.natsPublisher
        .publishSkillChanged(tenantId, skill.id, "updated", {
          name: skill.name,
        })
        .catch((err) =>
          this.logger.warn("NATS publish failed on skill update", err)
        );
    }

    return skill ?? null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const result = await sql`
      UPDATE skills
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING id
    `;
    if (result.length > 0) {
      this.natsPublisher
        .publishSkillChanged(tenantId, id, "deleted")
        .catch((err) =>
          this.logger.warn("NATS publish failed on skill delete", err)
        );
    }

    return result.length > 0;
  }
}
