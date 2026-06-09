import type { SKBColumnType } from "./types/skb.types";

/**
 * Cast a single string value to its typed representation based on column type.
 *
 * Rules (ported from Python mongo_service._cast_value):
 * - Empty/whitespace → null
 * - NUMERIC: handles European (1.250,00) and English (1,250.00) formats
 * - BOOLEAN: true/yes/1/verdadero/si/sí → true, false/no/0/falso → false
 * - TEXT/CATEGORICAL/DATE/UNKNOWN: return trimmed string
 */
export function castValue(value: string, colType: SKBColumnType): unknown {
  if (!value || value.trim() === "") return null;

  const v = value.trim();

  switch (colType) {
    case "numeric": {
      const hasComma = v.includes(",");
      const hasDot = v.includes(".");

      let normalized: string;
      if (hasComma && hasDot) {
        const lastComma = v.lastIndexOf(",");
        const lastDot = v.lastIndexOf(".");
        if (lastComma > lastDot) {
          // European: 1.250,00 → comma is decimal separator
          normalized = v.replace(/\./g, "").replace(",", ".");
        } else {
          // English: 1,250.00 → dot is decimal separator
          normalized = v.replace(/,/g, "");
        }
      } else if (hasComma) {
        // Only comma: treat as decimal separator
        normalized = v.replace(",", ".");
      } else {
        // Only dot or no separator: standard float
        normalized = v;
      }

      const f = parseFloat(normalized);
      if (isNaN(f)) return v; // return original string if unparseable
      return Number.isInteger(f) ? f : f;
    }

    case "boolean": {
      const lower = v.toLowerCase();
      if (["true", "yes", "1", "verdadero", "si", "sí"].includes(lower)) return true;
      if (["false", "no", "0", "falso"].includes(lower)) return false;
      return v; // ambiguous — return as-is
    }

    // text, categorical, date, unknown — all return trimmed string
    default:
      return v;
  }
}

/**
 * Cast every column in a single row according to the column type map.
 * Columns not present in the type map are left as-is (unchanged).
 */
export function castRow(
  row: Record<string, string>,
  columnTypes: Map<string, SKBColumnType>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const type = columnTypes.get(key);
    result[key] = type ? castValue(value, type) : value;
  }
  return result;
}

/**
 * Cast multiple rows using the same column type map.
 */
export function castBatch(
  rows: Record<string, string>[],
  columnTypes: Map<string, SKBColumnType>,
): Record<string, unknown>[] {
  return rows.map((row) => castRow(row, columnTypes));
}
