import { Injectable } from '@nestjs/common';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

export interface Job {
  id: string;
  name: string;
  agent_id: string;
  schedule: string;
  payload: Record<string, unknown>;
  is_active: boolean;
  last_run: Date | null;
  next_run: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateJobData {
  name: string;
  agent_id: string;
  schedule: string;
  payload?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateJobData {
  name?: string;
  agent_id?: string;
  schedule?: string;
  payload?: Record<string, unknown>;
  is_active?: boolean;
}

export interface FindAllOptions {
  agent_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

@Injectable()
export class JobsRepository {
  constructor(
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  private getSql(tenantId: string): Sql {
    return this.connectionManager.getConnection(tenantId);
  }

  /**
   * Lista todos los jobs con filtros opcionales y paginación.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ jobs: Job[]; total: number }> {
    const sql = this.getSql(tenantId);
    const { agent_id, is_active, limit = 20, offset = 0 } = options;

    // Build conditions as parameterized fragments
    const conditions: string[] = [];

    if (agent_id) {
      conditions.push(sql`agent_id = ${agent_id}` as unknown as string);
    }

    if (is_active !== undefined) {
      conditions.push(sql`is_active = ${is_active}` as unknown as string);
    }

    const whereClause = conditions.length > 0
      ? conditions.join(' AND ')
      : '1=1';

    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM jobs WHERE ${sql.unsafe(whereClause)}
    `;
    const total = Number(countResult[0].count);

    const jobs = await sql<Job[]>`
      SELECT 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
      FROM jobs
      WHERE ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { jobs, total };
  }

  /**
   * Busca un job por su ID.
   */
  async findById(tenantId: string, id: string): Promise<Job | null> {
    const sql = this.getSql(tenantId);

    const results = await sql<Job[]>`
      SELECT 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
      FROM jobs
      WHERE id = ${id}
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Crea un nuevo job calculando next_run.
   */
  async create(
    tenantId: string,
    data: CreateJobData,
  ): Promise<Job> {
    const sql = this.getSql(tenantId);

    const nextRun = this.calculateNextRun(data.schedule);

    const results = await sql<Job[]>`
      INSERT INTO jobs (
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
      ) VALUES (
        ${data.name},
        ${data.agent_id},
        ${data.schedule},
        ${sql.json((data.payload ?? {}) as JsonValue)},
        ${data.is_active ?? true},
        NULL,
        ${nextRun},
        NOW(),
        NOW()
      )
      RETURNING 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
    `;

    return results[0];
  }

  /**
   * Actualiza un job existente recalculando next_run si cambia el schedule.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateJobData,
  ): Promise<Job | null> {
    const sql = this.getSql(tenantId);

    // Build dynamic SET clauses using parameterized fragments
    const setClauses: string[] = ['updated_at = NOW()'];
    
    if (data.name !== undefined) {
      setClauses.push(sql`name = ${data.name}` as unknown as string);
    }
    if (data.agent_id !== undefined) {
      setClauses.push(sql`agent_id = ${data.agent_id}` as unknown as string);
    }
    if (data.schedule !== undefined) {
      setClauses.push(sql`schedule = ${data.schedule}` as unknown as string);
      const nextRun = this.calculateNextRun(data.schedule);
      setClauses.push(sql`next_run = ${nextRun}` as unknown as string);
    }
    if (data.payload !== undefined) {
      setClauses.push(sql`payload = ${sql.json(data.payload as JsonValue)}` as unknown as string);
    }
    if (data.is_active !== undefined) {
      setClauses.push(sql`is_active = ${data.is_active}` as unknown as string);
    }

    const setClause = setClauses.join(', ');

    const results = await sql<Job[]>`
      UPDATE jobs
      SET ${sql.unsafe(setClause)}
      WHERE id = ${id}
      RETURNING 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Elimina un job.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = this.getSql(tenantId);

    const results = await sql<{ id: string }[]>`
      DELETE FROM jobs
      WHERE id = ${id}
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Activa un job.
   */
  async enable(tenantId: string, id: string): Promise<Job | null> {
    const sql = this.getSql(tenantId);

    const results = await sql<Job[]>`
      UPDATE jobs
      SET 
        is_active = true,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Desactiva un job.
   */
  async disable(tenantId: string, id: string): Promise<Job | null> {
    const sql = this.getSql(tenantId);

    const results = await sql<Job[]>`
      UPDATE jobs
      SET 
        is_active = false,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Actualiza last_run y recalcula next_run.
   */
  async updateLastRun(tenantId: string, id: string, schedule: string): Promise<Job | null> {
    const sql = this.getSql(tenantId);
    const nextRun = this.calculateNextRun(schedule);

    const results = await sql<Job[]>`
      UPDATE jobs
      SET 
        last_run = NOW(),
        next_run = ${nextRun},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING 
        id,
        name,
        agent_id,
        schedule,
        payload,
        is_active,
        last_run,
        next_run,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Calcula la próxima ejecución basado en el schedule.
   * Soporta: cron expression, interval:X (minutos), once
   */
  private calculateNextRun(schedule: string): Date | null {
    const now = new Date();

    if (schedule === 'once') {
      return null;
    }

    if (schedule.startsWith('interval:')) {
      const minutes = parseInt(schedule.split(':')[1], 10);
      if (isNaN(minutes)) {
        return null;
      }
      return new Date(now.getTime() + minutes * 60 * 1000);
    }

    // Asumimos que es una expresión cron - para simplificar, usamos NOW() + 1 hora
    // En producción se usaría una librería como cron-parser
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
}
