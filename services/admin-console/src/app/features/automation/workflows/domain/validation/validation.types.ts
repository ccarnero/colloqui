/**
 * Pre-save validation types for the workflow builder.
 *
 * The validators live in the domain layer and have no Angular
 * dependencies so they are unit-testable in isolation. They mirror
 * the backend `IsWorkflowActionArrayConstraint` rules, with one
 * deliberate UX-driven exception for `endpointCall` (see
 * `action-validators.ts`).
 */

export type ValidationCode =
  | "REQUIRED"
  | "INVALID_VALUE"
  | "INVALID_JSON"
  | "NO_TRIGGER"
  | "MULTIPLE_TRIGGERS"
  | "TRIGGER_DISCONNECTED"
  | "EMPTY_ACTIONS"
  | "ORPHAN_NODE"
  | "CYCLE_DETECTED"
  | "INVALID_CONNECTION"
  | "BRANCH_EMPTY"
  | "CONDITIONAL_NO_BRANCHES"
  | "CONDITIONAL_INVALID_VARIABLE"
  | "CONDITIONAL_INVALID_COMPARATOR"
  | "MAX_DEPTH_EXCEEDED"
  | "TOO_LONG"
  | "INVALID_ENUM";

/** Workflow-level: where the error happened. */
export interface ValidationError {
  /** Visual node key, when the error is tied to a specific node. */
  nodeKey?: string;
  /** Human-readable node name, for display in the dialog. */
  nodeName?: string;
  /** Dot-notation path within the action/trigger payload (e.g. `args.url`). */
  field?: string;
  /** Stable error code for i18n / programmatic handling. */
  code: ValidationCode;
  /** English message ready to render (i18n later if needed). */
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export const EMPTY_VALIDATION_RESULT: ValidationResult = {
  valid: true,
  errors: [],
};

/** Backend caps used here for parity. */
export const WORKFLOW_NAME_MAX = 128;
export const WORKFLOW_APPLICATION_MAX = 64;

/** Mirrors `MAX_BRANCH_DEPTH` in `workflow-action.validator.ts`. */
export const MAX_BRANCH_DEPTH = 12;
