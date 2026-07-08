import { Injectable } from "@nestjs/common";
import { generateObject } from "ai";
import { createSkbLanguageModel } from "./skb-llm.config";
import type { ParsedTable } from "./types/skb.types";

export interface ColumnSchema {
  name: string;
  original_name: string;
  type: string;
  description: string;
  sample_values: string[];
  is_filterable: boolean;
  query_hints: string[];
}

export interface SKBSchemaResult {
  table_description: string;
  query_rules: string;
  columns: ColumnSchema[];
  rowCount: number;
  analyzed_at: string;
}

export interface SchemaProviderConfig {
  provider: string;
  apiKey: string;
  apiBaseUrl: string;
}

const SCHEMA_SYSTEM_PROMPT = `You are a data schema analyst. Given a parsed CSV/Excel table with headers, sample rows, and heuristic type hints, produce a structured schema that describes each column's semantic type and purpose.

Rules:
1. Column types must be one of: "text", "numeric", "categorical", "boolean", "date", "unknown"
2. "is_filterable" should be true unless the column has high cardinality or is free-form text
3. Provide concise but clear descriptions for each column
4. "sample_values" should contain the unique values shown in the sample rows, limited to 5 distinct values
5. "query_hints" suggest natural language query patterns for this column
6. The "table_description" should summarize what the data represents
7. "query_rules" should describe how to query this table in natural language`;

@Injectable()
export class SKBSchemaAnalyzerService {
  async analyze(
    parsed: ParsedTable,
    providerConfig?: SchemaProviderConfig,
    modelName?: string
  ): Promise<SKBSchemaResult> {
    const heuristicHints = this.buildHeuristicHints(parsed);
    const typeSummary = [
      ...new Set(Object.values(heuristicHints).map((h) => h.detected_type)),
    ];

    const userPrompt = `Analyze this table and produce a structured schema.

Table headers:
${parsed.originalHeaders.join(", ")}

Normalized headers:
${parsed.headers.join(", ")}

Total rows: ${parsed.rowCount}

Sample rows (first ${Math.min(parsed.rows.length, 5)}):
${JSON.stringify(parsed.rows.slice(0, 5), null, 2)}

Heuristic type hints per column:
${JSON.stringify(heuristicHints, null, 2)}

Detected types summary: ${typeSummary.join(", ")}
Cardinality report: ${Object.entries(heuristicHints)
      .map(([col, h]) => `${col}=${h.cardinality}`)
      .join(", ")}

Column type candidates: boolean, numeric, categorical, text, date, unknown`;

    const { object } = await (generateObject as any)({
      model: this.buildModel(providerConfig, modelName),
      system: SCHEMA_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: this.buildOutputSchema(),
    });

    const result = object as {
      table_description: string;
      query_rules: string;
      columns: ColumnSchema[];
    };

    return {
      table_description: result.table_description,
      query_rules: result.query_rules,
      columns: result.columns.map((col) => ({
        name: col.name,
        original_name: col.original_name,
        type: col.type,
        description: col.description,
        sample_values: col.sample_values,
        is_filterable: col.is_filterable,
        query_hints: col.query_hints,
      })),
      rowCount: parsed.rowCount,
      analyzed_at: new Date().toISOString(),
    };
  }

  private buildModel(
    providerConfig?: SchemaProviderConfig,
    modelName?: string
  ): any {
    return createSkbLanguageModel(providerConfig?.provider, modelName);
  }

  private buildOutputSchema(): any {
    return {
      type: "object",
      properties: {
        table_description: { type: "string" },
        query_rules: { type: "string" },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              original_name: { type: "string" },
              type: { type: "string" },
              description: { type: "string" },
              sample_values: { type: "array", items: { type: "string" } },
              is_filterable: { type: "boolean" },
              query_hints: { type: "array", items: { type: "string" } },
            },
            required: [
              "name",
              "original_name",
              "type",
              "description",
              "sample_values",
              "is_filterable",
              "query_hints",
            ],
          },
        },
      },
      required: ["table_description", "query_rules", "columns"],
    };
  }

  private buildHeuristicHints(
    parsed: ParsedTable
  ): Record<string, { detected_type: string; cardinality: number }> {
    const hints: Record<
      string,
      { detected_type: string; cardinality: number }
    > = {};

    for (const header of parsed.headers) {
      const values = parsed.rows.map((r) => r[header]).filter(Boolean);
      const uniqueValues = new Set(values);
      const cardinality = uniqueValues.size;

      // Heuristic type detection
      let detectedType = "text";
      if (values.length > 0) {
        const nonEmpty = values.filter((v) => v !== "");
        if (nonEmpty.length > 0) {
          const allNumeric = nonEmpty.every(
            (v) => !isNaN(Number(v)) && v.trim() !== ""
          );
          const allBoolean = nonEmpty.every(
            (v) => v === "true" || v === "false"
          );
          const allDates = nonEmpty.every((v) => {
            const d = new Date(v);
            return !isNaN(d.getTime()) && /^\d{4}/.test(v);
          });

          if (allBoolean) {
            detectedType = "boolean";
          } else if (allNumeric) {
            detectedType = "numeric";
          } else if (allDates) {
            detectedType = "date";
          } else if (cardinality <= 10 && values.length > 10) {
            detectedType = "categorical";
          } else {
            detectedType = "text";
          }
        }
      }

      hints[header] = {
        detected_type: detectedType,
        cardinality,
      };
    }

    return hints;
  }
}
