import { Inject, Injectable, Optional } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { generateObject } from "ai";
import { z } from "zod";
import {
  createSkbLanguageModel,
  resolveSkbLlmCredentials,
} from "./skb-llm.config";
import {
  clampLimit,
  DEFAULT_LIMIT,
  isSafe,
  MAX_LIMIT,
  validateWhereClause,
} from "./skb-sql-safety";

// ---------------------------------------------------------------------------
// Zod schema for LLM output
// ---------------------------------------------------------------------------

// OpenAI strict-mode structured outputs require every property to be
// listed in `required`, so optional fields must be modeled as nullable
// (present but null) rather than absent.
const SQLTranslationZod = z.object({
  where_clause: z.string(),
  order_by: z.string().nullable(),
  explanation: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const QUERY_SYSTEM_PROMPT = `You are a SQL query translator for a structured knowledge base.
Translate natural language queries into safe SQL WHERE clauses and ORDER BY clauses.

RULES:
1. Only generate WHERE conditions and ORDER BY. Never generate SELECT, FROM, INSERT, UPDATE, DELETE, DROP, etc.
2. Use ONLY the column names listed in the schema.
3. For text columns use ILIKE for case-insensitive matching.
4. For categorical columns use exact match with IN or =.
5. For numeric columns use standard comparison operators.
6. For date columns use PostgreSQL date functions.
7. Access column values via (data->>'column_name') for text comparisons
   or (data->>'column_name')::numeric for numeric comparisons.
8. Use parentheses to group OR conditions properly.
9. NEVER include semicolons or stacked queries.`;

function buildQueryPrompt(
  nlQuery: string,
  schemas: Array<{
    table_description: string;
    query_rules: string;
    columns: Array<{
      name: string;
      type: string;
      description: string;
      sample_values: string[];
      is_filterable: boolean;
      query_hints: string[];
    }>;
  }>,
  categories: string[]
): string {
  // Merge columns from all schemas (deduplicate by name)
  const columnMap = new Map<
    string,
    {
      name: string;
      type: string;
      description: string;
      sample_values: string[];
      is_filterable: boolean;
      query_hints: string[];
    }
  >();
  for (const schema of schemas) {
    for (const col of schema.columns) {
      if (!columnMap.has(col.name)) {
        columnMap.set(col.name, col);
      }
    }
  }
  const allColumns = Array.from(columnMap.values());

  const columnsInfo = allColumns
    .map(
      (c) =>
        `- ${c.name} (${c.type}): ${c.description}. Filterable: ${c.is_filterable}. Hints: ${c.query_hints.join(", ")}`
    )
    .join("\n");

  const tableDescriptions = schemas
    .filter((s) => s.table_description)
    .map((s) => s.table_description)
    .join("; ");

  const queryRules = schemas
    .filter((s) => s.query_rules)
    .map((s) => s.query_rules)
    .join("; ");

  const tablesInfo = schemas
    .map(
      (s, i) =>
        `Table ${i + 1}: ${s.table_description}${s.query_rules ? ` (Rules: ${s.query_rules})` : ""}`
    )
    .join("\n");

  let prompt = `You are a SQL query translator. Translate the following natural language query into safe SQL WHERE and ORDER BY clauses for a PostgreSQL table.

Table information:
${tablesInfo}

Available columns:
${columnsInfo}`;

  if (categories.length > 0) {
    prompt += `\n\nCategory filter: The user is interested in the following categories — ${categories.join(", ")}. Include category filtering in your WHERE clause.`;
  }

  prompt += `\n\nIMPORTANT: Return ONLY the WHERE clause and optional ORDER BY. Never include SELECT, FROM, or any DDL/DML statements.

Natural language query: "${nlQuery}"`;

  if (tableDescriptions) {
    prompt += `\n\nTable description: ${tableDescriptions}`;
  }
  if (queryRules) {
    prompt += `\n\nQuery rules: ${queryRules}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryOptions {
  limit?: number;
  offset?: number;
  categories?: string[];
  /**
   * Attribution ids (metering-foundation.md G5), nullable. Threaded into
   * `skb_query_history` when the caller has them — today's only caller
   * (`StructuredKBController.query`, the admin API) has none, but an
   * agent-tool caller with real execution context can pass them here
   * without any other change to this service.
   */
  attribution?: {
    correlationId?: string | null;
    causationId?: string | null;
    executionId?: string | null;
  };
}

export interface QueryResult {
  results: Record<string, unknown>[];
  sql: string;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SKBQueryService {
  private readonly logger = new PinoLoggerService(SKBQueryService.name);

  constructor(
    @Inject("SKBSchemaRepository")
    private readonly schemaRepository: {
      loadAllSchemas(
        tenantId: string,
        containerId: string,
      ): Promise<
        Array<{
          table_description: string;
          query_rules: string;
          columns: Array<{
            name: string;
            original_name: string;
            type: string;
            description: string;
            sample_values: string[];
            is_filterable: boolean;
            query_hints: string[];
          }>;
          row_count: number;
          analyzed_at: string;
        }>
      >;
    },
    @Inject("SKBRowsRepository")
    private readonly rowsRepository: {
      executeQuery(
        tenantId: string,
        containerId: string,
        options: {
          whereClause: string;
          orderBy?: string;
          categories: string[];
          limit: number;
          offset: number;
        },
      ): Promise<{ results: Record<string, unknown>[]; totalCount: number }>;
      countByContainer(
        tenantId: string,
        containerId: string,
      ): Promise<number>;
    },
    @Inject("TenantConnectionManager")
    private readonly connectionManager: {
      ensureSchema(tenantId: string): Promise<void>;
    },
    @Optional()
    @Inject("SKBQueryHistoryService")
    private readonly queryHistoryService?: {
      recordQuery(
        tenantId: string,
        containerId: string,
        nlQuery: string,
        generatedSql: string,
        resultCount: number,
        durationMs: number,
        error?: string | null,
        userId?: string | null,
        errorMessage?: string | null,
        attribution?: {
          correlationId?: string | null;
          causationId?: string | null;
          executionId?: string | null;
        },
      ): Promise<unknown>;
    },
    @Optional()
    @Inject("SKBContainersService")
    private readonly containersService?: {
      findById(
        tenantId: string,
        id: string,
      ): Promise<{
        provider_config: Record<string, unknown>;
        query_model: string;
      } | null>;
    },
  ) {}

  async query(
    tenantId: string,
    containerId: string,
    nlQuery: string,
    options?: QueryOptions
  ): Promise<QueryResult> {
    const startedAt = Date.now();

    try {
      // 1. Load container schemas
      const schemas = await this.schemaRepository.loadAllSchemas(
        tenantId,
        containerId
      );

      // 2. Build prompt with schema context
      const prompt = buildQueryPrompt(
        nlQuery,
        schemas,
        options?.categories ?? []
      );

      // 3. Call generateObject to translate NL → SQL. Credentials resolve
      // from the container's provider_config connector when set, else from
      // the OPENAI_API_KEY env fallback.
      const container = await this.containersService?.findById(
        tenantId,
        containerId
      );
      const llmCredentials = await resolveSkbLlmCredentials(
        tenantId,
        container?.provider_config,
        this.logger
      );
      let object: {
        where_clause: string;
        order_by?: string;
        explanation?: string;
      };
      try {
        const result = await (generateObject as any)({
          model: createSkbLanguageModel(
            undefined,
            container?.query_model,
            llmCredentials
          ),
          schema: SQLTranslationZod,
          system: QUERY_SYSTEM_PROMPT,
          prompt,
        });
        object = result.object as {
          where_clause: string;
          order_by?: string;
          explanation?: string;
        };
      } catch (err) {
        throw new Error(`LLM translation failed: ${(err as Error).message}`);
      }

      // 4. Validate SQL safety
      const whereClause = object.where_clause ?? "";
      const orderBy = object.order_by;

      if (!isSafe(whereClause)) {
        throw new Error(
          "SQL safety violation: potentially dangerous pattern detected"
        );
      }
      validateWhereClause(whereClause);

      if (orderBy) {
        if (!isSafe(orderBy)) {
          throw new Error(
            "SQL safety violation: potentially dangerous pattern detected"
          );
        }
        validateWhereClause(orderBy);
      }

      // 5. Execute query.
      // The limit is clamped ONCE, here, so `executeQuery` (which binds it as
      // a parameter) and `buildSql` (which renders the debug string stored in
      // skb_query_history) see the exact same value and stay byte-identical.
      const requestedLimit = options?.limit ?? DEFAULT_LIMIT;
      const limit = clampLimit(requestedLimit, MAX_LIMIT);
      if (limit !== requestedLimit) {
        this.logger.warn(
          `SKB query limit ${requestedLimit} exceeds the SQL-layer cap ${MAX_LIMIT}; clamped to ${limit} for container ${containerId} (tenant ${tenantId})`
        );
      }
      const offset = options?.offset ?? 0;

      const result = await this.rowsRepository.executeQuery(
        tenantId,
        containerId,
        {
          whereClause,
          orderBy,
          categories: options?.categories ?? [],
          limit,
          offset,
        }
      );

      // 6. Build SQL representation for debugging
      const sql = this.buildSql(
        tenantId,
        containerId,
        whereClause,
        orderBy,
        options?.categories ?? [],
        limit,
        offset
      );

      this.recordQueryHistory(
        tenantId,
        containerId,
        nlQuery,
        sql,
        result.totalCount,
        Date.now() - startedAt,
        null,
        options?.attribution
      );

      return {
        results: result.results,
        sql,
        totalCount: result.totalCount,
      };
    } catch (err) {
      this.recordQueryHistory(
        tenantId,
        containerId,
        nlQuery,
        "",
        0,
        Date.now() - startedAt,
        err instanceof Error ? err.message : String(err),
        options?.attribution
      );
      throw err;
    }
  }

  /**
   * Records a query in `skb_query_history` for observability/debugging.
   * Fire-and-forget: a history-write failure is logged as a warning and
   * never propagates — recording history must never break a query.
   */
  private recordQueryHistory(
    tenantId: string,
    containerId: string,
    nlQuery: string,
    generatedSql: string,
    resultCount: number,
    durationMs: number,
    error: string | null,
    attribution?: QueryOptions["attribution"]
  ): void {
    if (!this.queryHistoryService) {
      return;
    }

    this.queryHistoryService
      .recordQuery(
        tenantId,
        containerId,
        nlQuery,
        generatedSql,
        resultCount,
        durationMs,
        error,
        null,
        null,
        attribution
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to record SKB query history for container ${containerId}: ${err instanceof Error ? err.message : String(err)}`
        );
      });
  }

  private buildSql(
    tenantId: string,
    containerId: string,
    whereClause: string,
    orderBy: string | undefined,
    categories: string[],
    limit: number,
    offset: number
  ): string {
    const whereParts: string[] = [
      `container_id = '${containerId}'`,
      `tenant_id = '${tenantId}'`,
    ];

    if (whereClause.trim()) {
      whereParts.push(`(${whereClause})`);
    }

    if (categories.length > 0) {
      whereParts.push(`categories @> '${JSON.stringify(categories)}'::jsonb`);
    }

    const where = whereParts.join(" AND ");
    const orderClause = orderBy?.trim()
      ? `ORDER BY ${orderBy}`
      : "ORDER BY created_at DESC";
    const limitClause = `LIMIT ${limit} OFFSET ${offset}`;

    return `SELECT data FROM skb_rows WHERE ${where} ${orderClause} ${limitClause}`;
  }
}
