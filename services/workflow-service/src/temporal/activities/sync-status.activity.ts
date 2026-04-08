import postgres from "postgres";
import type { Sql } from "postgres";
import { workflowServiceConfig } from "../../config";

let sql: Sql | null = null;

function getPool(): Sql {
  if (sql) return sql;
  const cfg = workflowServiceConfig;
  sql = postgres({
    host: cfg.postgresHost,
    port: cfg.postgresPort,
    database: cfg.postgresDb,
    username: cfg.postgresUser,
    password: cfg.postgresPassword,
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return sql;
}

/**
 * Persists the terminal workflow status to Postgres so the execution
 * row reflects the real Temporal outcome without requiring a poll.
 *
 * @param executionId - The `workflow_executions.id` primary key.
 * @param status - Temporal status name (e.g. "COMPLETED", "FAILED").
 */
export async function syncExecutionStatus(
  executionId: string,
  status: string,
): Promise<void> {
  const pool = getPool();
  await pool`
    UPDATE workflow_executions
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${executionId}
  `;
}
