import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { EventEnvelope } from "@yoizen/shared";
import { ensurePostgresTenantNamespaceOnce } from "../../common/ensure-tenant-schema.postgres";
import {
  EXECUTION_AUDIT_SELECT_PROJECTION,
  type IExecutionLifecyclePayload,
  type IStoredExecutionEvent,
} from "../../common/execution-audit-projection";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IExecutionAuditQueryParams,
  IExecutionAuditRepository,
} from "./execution-audit.repository.interface";

@Injectable()
export class ExecutionAuditPostgresRepository
  implements IExecutionAuditRepository
{
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  private async ensureExecutionEventsTable(tenantId: string): Promise<void> {
    await ensurePostgresTenantNamespaceOnce(
      this.tenantConnections,
      tenantId,
      "execution_audit",
      async (s) => {
        await s`
          CREATE TABLE IF NOT EXISTS execution_events (
            id                  TEXT        PRIMARY KEY,
            tenant_id           TEXT        NOT NULL,
            execution_id        TEXT        NOT NULL,
            event_kind          TEXT        NOT NULL,
            agent_id            TEXT,
            conversation_id     TEXT,
            model               TEXT,
            provider            TEXT,
            input_tokens        INTEGER,
            output_tokens       INTEGER,
            cached_input_tokens INTEGER,
            cost_usd            NUMERIC,
            status              TEXT,
            error               TEXT,
            correlation_id      TEXT,
            causation_id        TEXT,
            depth               INTEGER     NOT NULL DEFAULT 0,
            occurred_at         TIMESTAMPTZ NOT NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        await s`CREATE INDEX IF NOT EXISTS idx_exec_evt_execution ON execution_events (execution_id, created_at)`;
        await s`CREATE INDEX IF NOT EXISTS idx_exec_evt_conversation ON execution_events (conversation_id, created_at)`;
        await s`CREATE INDEX IF NOT EXISTS idx_exec_evt_agent ON execution_events (agent_id, created_at DESC)`;
        await s`CREATE INDEX IF NOT EXISTS idx_exec_evt_correlation ON execution_events (correlation_id, depth, created_at)`;
        await s`CREATE INDEX IF NOT EXISTS idx_exec_evt_causation ON execution_events (causation_id)`;
      }
    );
  }

  async insertExecutionEvent(
    envelope: EventEnvelope,
    payload: IExecutionLifecyclePayload,
    _natsSubject: string
  ): Promise<void> {
    const tenantId = envelope.tenant;
    if (!tenantId) {
      return;
    }

    await this.ensureExecutionEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const status = payload.reason ?? payload.state ?? null;

    await sql`
      INSERT INTO execution_events (
        id, tenant_id, execution_id, event_kind,
        agent_id, conversation_id, model, provider,
        input_tokens, output_tokens, cached_input_tokens, cost_usd,
        status, error,
        correlation_id, causation_id, depth,
        occurred_at, created_at
      ) VALUES (
        ${envelope.id},
        ${tenantId},
        ${payload.executionId},
        ${payload.state},
        ${payload.agentId ?? null},
        ${envelope.correlation_id ?? null},
        ${payload.model ?? null},
        ${payload.provider ?? null},
        ${payload.usage?.inputTokens ?? null},
        ${payload.usage?.outputTokens ?? null},
        ${payload.usage?.cachedInputTokens ?? null},
        ${payload.costUsd ?? null},
        ${status},
        ${payload.error ?? null},
        ${envelope.correlation_id ?? null},
        ${envelope.causation_id ?? null},
        ${envelope.transport?.depth ?? 0},
        ${envelope.time ?? new Date().toISOString()},
        ${new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async queryEvents(
    params: IExecutionAuditQueryParams,
    tenantId: string
  ): Promise<IStoredExecutionEvent[]> {
    const { executionId, conversationId, agentId, from, to, limit, offset } =
      params;
    await this.ensureExecutionEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    return sql<IStoredExecutionEvent[]>`
      SELECT ${sql.unsafe(EXECUTION_AUDIT_SELECT_PROJECTION)}
      FROM execution_events
      WHERE 1=1
        ${executionId ? sql`AND execution_id = ${executionId}` : sql``}
        ${conversationId ? sql`AND conversation_id = ${conversationId}` : sql``}
        ${agentId ? sql`AND agent_id = ${agentId}` : sql``}
        ${from ? sql`AND occurred_at >= ${from}` : sql``}
        ${to ? sql`AND occurred_at <= ${to}` : sql``}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  async getEventById(
    id: string,
    tenantId: string
  ): Promise<IStoredExecutionEvent | null> {
    await this.ensureExecutionEventsTable(tenantId);
    const sql = this.tenantConnections.getConnection(tenantId);

    const rows = await sql<IStoredExecutionEvent[]>`
      SELECT ${sql.unsafe(EXECUTION_AUDIT_SELECT_PROJECTION)}
      FROM execution_events
      WHERE id = ${id}
    `;

    return rows[0] ?? null;
  }
}
