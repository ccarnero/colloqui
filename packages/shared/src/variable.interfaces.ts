/** Variable types for the scoped variable system */
export type VariableType = "string" | "number" | "boolean" | "json" | "array" | "secret";

/** Declaration of a variable (input or output) */
export interface VariableDeclaration {
  name: string;
  type: VariableType;
  label?: string;
  description?: string;
  required?: boolean;       // default: true
  defaultValue?: unknown;   // must match type
}

/** A data-flow connection between two workflow nodes */
export interface IDataConnection {
  key: string;
  source: string;            // source node key
  target: string;            // target node key
  sourceVariable: string;    // output variable name on source
  targetVariable: string;    // input variable name on target
}

/** Resolution context passed at runtime */
export interface VariableResolutionContext {
  system: Record<string, unknown>;
  workflow: Record<string, unknown>;
  previous: Record<string, unknown>;
  node: Record<string, Record<string, unknown>>;
  request: Record<string, unknown>;
}
