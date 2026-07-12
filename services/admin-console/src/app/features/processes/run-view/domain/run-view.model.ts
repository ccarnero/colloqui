/**
 * run-view.model.ts — pure domain types for the workflow run view (T03 of
 * manual-loops/run-view.md). No Angular/DOM imports (only `import type`
 * references into `core/services/` for wire-faithful input shapes — same
 * precedent `causal-graph-geometry.ts` already established: type-only
 * imports erase at compile time, so this module carries zero runtime
 * Angular dependency).
 *
 * Two stages, mirroring `assemble-trace.ts` + `causal-graph-geometry.ts`:
 *   1. `merge-run.ts`  (events, spans, definition) -> `IMergedRun` (step tree)
 *   2. `layout-run.ts` `IMergedRun` -> `IRunLayout` (equally-spaced geometry)
 *
 * SCOPE NOTE: the step tree/layout below cover the workflow ACTIONS only
 * (the hard part per SPEC.md: branch/condition/fork/join/bypass/critical
 * path). The header chips (workflow/run_id/status/duration/correlation) and
 * the trigger/"run started"/"execution completed" spine frame are trivially
 * derivable from `IRunResponse.summary`/`cast` by T04's component — they
 * carry no branch/fork geometry decisions, so they are NOT modeled here.
 */

// ── Definition-side mirror types ─────────────────────────────────────
//
// Local MIRROR of `@yoizen/shared`'s `WorkflowAction` union
// (`packages/shared/src/workflow.interfaces.ts`) — deliberately NOT
// imported from `@yoizen/shared` itself. That package's barrel
// (`src/index.ts`) re-exports `envelope.utils.ts`, which imports
// `node:crypto`/`Buffer` — a runtime-only module the admin-console's
// browser build cannot resolve, even for a type-only import (esbuild
// still needs to parse the whole barrel to resolve the type). Every
// other admin-console model that mirrors a `@yoizen/shared` shape does
// the same (see `core/models/agent.model.ts`, `scheduler.model.ts`,
// `core/services/knowledge-bases.service.ts`'s header comments) — this
// follows that established convention, not a new one.
export type WorkflowActionKind =
  | "endpointCall"
  | "mcpCall"
  | "jsFunction"
  | "serviceBusCall"
  | "serviceCall"
  | "channelSend"
  | "agentCall"
  | "branch"
  | "conditional";

/** A single leaf action (every `WorkflowActionKind` except the
 * structural `branch`/`conditional`). */
export interface IWorkflowLeafAction {
  readonly activity: Exclude<WorkflowActionKind, "branch" | "conditional">;
  readonly name: string;
}

/** Mirrors `BranchAction`: `[branchName: string]: WorkflowAction[] | string`
 * besides `activity`/`name` — a fork's lanes are its own enumerable keys. */
export interface IWorkflowBranchAction {
  readonly activity: "branch";
  readonly name: string;
  readonly [laneKey: string]: WorkflowActionInput[] | string;
}

export interface IWorkflowConditionRule {
  readonly variable: string;
  readonly comparator: string;
  readonly value: string;
}

export interface IWorkflowConditionalBranch {
  readonly label: string;
  readonly condition: IWorkflowConditionRule;
  readonly actions: WorkflowActionInput[];
}

export interface IWorkflowConditionalAction {
  readonly activity: "conditional";
  readonly name: string;
  readonly branches: readonly IWorkflowConditionalBranch[];
  readonly default?: WorkflowActionInput[];
}

export type WorkflowActionInput =
  | IWorkflowLeafAction
  | IWorkflowBranchAction
  | IWorkflowConditionalAction;

export type StepColor = "platform" | "decision" | "agent" | "channel";

export type ActionStatus = "ok" | "failed" | "not_executed";

/** Start/completion instants, when known (`null` for a not-executed step,
 * or when no span paired for an executed one). Point events (e.g.
 * `condition_evaluated`) report the same instant for both. */
export interface ITimeRange {
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** One leaf action step — every `WorkflowAction.activity` except the
 * structural `branch`/`conditional` (see `IForkStep`/`IConditionalStep`). */
export interface IActionStep extends ITimeRange {
  readonly type: "action";
  /** 0-based position within this step's OWN action list (top-level, a
   * fork lane, or a conditional branch/default list) — NOT globally
   * unique, mirrors `IPublishActionStartedArgs.actionIndex`. */
  readonly actionIndex: number;
  /** Enclosing fork/conditional branch path (`"pathA/approved"`), `null`
   * at the top level — mirrors `action_started.branch`. */
  readonly branchPath: string | null;
  readonly nestingDepth: number;
  readonly actionType: string;
  readonly name: string;
  readonly color: StepColor;
  readonly status: ActionStatus;
  /** `payload_connector_id ?? payload_agent_id` off the matched executed
   * event; `null` for a not-executed step (DESIGN.md: labels only, no
   * instance name for definition-only branches) or an action kind that
   * carries neither (`jsFunction`, `serviceBusCall`, `channelSend`). */
  readonly instanceId: string | null;
  readonly durationMs: number | null;
}

/** One declared branch (case or default) of a `conditional` node, ALWAYS
 * present regardless of whether it was taken — untaken branches walk to
 * an all-`not_executed` subtree automatically (no events match their
 * branch path), giving "plan-vs-executed" for free. */
export interface IConditionalBranchNode {
  /** Case label, or `"default"` for the fallback branch. */
  readonly label: string;
  readonly taken: boolean;
  readonly steps: readonly StepNode[];
}

export interface IConditionalStep extends ITimeRange {
  readonly type: "conditional";
  readonly actionIndex: number;
  readonly branchPath: string | null;
  readonly nestingDepth: number;
  readonly name: string;
  readonly color: "decision";
  /** `false` when no matching `condition_evaluated` event was found —
   * either a definition-only conditional (not-executed ancestor branch)
   * or a genuinely degraded run. */
  readonly executed: boolean;
  readonly expression: string | null;
  readonly evaluatedValue: string | null;
  /** Matched case label, `"default"`, or `null` for an if-without-else
   * evaluating false (or a not-executed conditional). */
  readonly branchTaken: string | null;
  readonly hasDefault: boolean;
  readonly branches: readonly IConditionalBranchNode[];
}

export interface IForkLane {
  readonly label: string;
  readonly steps: readonly StepNode[];
}

export interface IForkStep extends ITimeRange {
  readonly type: "fork";
  readonly actionIndex: number;
  readonly branchPath: string | null;
  readonly nestingDepth: number;
  readonly name: string;
  readonly color: "platform";
  readonly status: ActionStatus;
  readonly durationMs: number | null;
  readonly lanes: readonly IForkLane[];
}

export type StepNode = IActionStep | IConditionalStep | IForkStep;

export interface IMergedRun {
  readonly steps: readonly StepNode[];
  /** `true` when the run's OWN scoped events contain none of the
   * step-level kinds (`action_started`/`action_completed`/
   * `condition_evaluated`) — mirrors `RunResponse.step_detail === false`
   * (T01). `layout-run.ts` renders the artifact-only spine + banner for
   * this case (SPEC.md constraint: "graceful degradation is a FEATURE"). */
  readonly degraded: boolean;
}

// ── Layout (geometry) model ──────────────────────────────────────────

export type LayoutNodeKind = "action" | "conditional" | "fork" | "join";

/** Lane cap for a fork segment (DESIGN.md: "max 2-3, then collapse to
 * summary"). Beyond this, extra lanes collapse into `IForkGeometry`'s
 * `collapsedCount` instead of a node/edge per step. */
export const FORK_LANE_CAP = 3;

export interface ILayoutNode {
  readonly id: string;
  readonly kind: LayoutNodeKind;
  readonly color: StepColor;
  readonly label: string;
  readonly status: ActionStatus;
  /** Equally-spaced vertical position — NOT time-scaled (decision 1). */
  readonly row: number;
  /** `0` = spine; `>0` = fork lane index (1-based, capped at
   * `FORK_LANE_CAP`). */
  readonly lane: number;
  readonly nestingDepth: number;
  readonly durationMs: number | null;
  /** `true` for a definition-only, not-executed step (dashed box). */
  readonly dashed: boolean;
}

export type LayoutEdgeKind =
  | "linear"
  | "taken"
  | "not-taken"
  | "bypass"
  | "fork-out"
  | "join-in";

export interface ILayoutEdge {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: LayoutEdgeKind;
  readonly dashed: boolean;
  /** Thick = taken branch, bypass, or the join's critical-path edge. */
  readonly thick: boolean;
  readonly label: string | null;
}

/** Per-fork-node geometry summary — lane count/cap and the join's
 * critical-path selection (DESIGN.md: "slowest branch's edge is THICKER
 * and labeled `ruta crítica · <ms>`"). */
export interface IForkGeometry {
  readonly forkId: string;
  readonly joinId: string;
  readonly laneLabels: readonly string[];
  /** Lanes actually rendered (`min(laneLabels.length, FORK_LANE_CAP)`). */
  readonly visibleLaneCount: number;
  /** Lanes beyond `FORK_LANE_CAP`, collapsed to a summary chip. */
  readonly collapsedCount: number;
  /** Label of the lane with the largest elapsed span — `null` when no
   * lane has timing data (degraded/no spans). */
  readonly criticalLane: string | null;
  readonly criticalMs: number | null;
}

export interface IRunLayout {
  readonly nodes: readonly ILayoutNode[];
  readonly edges: readonly ILayoutEdge[];
  readonly forks: readonly IForkGeometry[];
  readonly degraded: boolean;
}
