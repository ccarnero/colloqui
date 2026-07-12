// merge-run.ts — (events, spans, definition) -> step tree (T03 of
// manual-loops/run-view.md, "the hard pure core"). Pure function: no
// Angular/DOM, no I/O. Walks the workflow DEFINITION's action tree
// (`@yoizen/shared`'s `WorkflowAction` union) and, for every action,
// matches it against the run's executed events by
// `(branchPath, actionIndex)` — the SAME identity `workflows.ts` uses to
// emit `action_started`/`action_completed` (`combineBranchLabel` for
// nested paths). Untaken conditional branches and not-executed
// definition-only steps need NO special-casing: they simply find no
// matching events and fall out as `status: "not_executed"` naturally,
// which is what gives "plan-vs-executed from day one" (SPEC decision 4).
//
// SPAN-MATCHING FINDING (documented, not fixed — out of this task's
// scope, `src/sql/span-pairs.sql` is tracking-ingester-service DDL):
// `tracking.tracked_event_spans`' pairing JOIN keys ONLY on
// `(entity_id, kind_prefix)`. Every `action_started`/`action_completed`
// row in a run shares the SAME `entity_id` (the run's `executionId`,
// via the view's `executionId` COALESCE branch) AND the SAME
// `kind_prefix` (`"action"`, stripped of `_started`/`_completed`) —
// action spans do not carry a distinguishing key at the SQL layer, so
// the view's JOIN produces a cartesian match per run (every started row
// paired with every completed row of the run), not a 1:1 pairing. This
// function works around the AMBIGUITY (not the ingester bug) by
// matching a span to a specific action via `span.event_id ===
// startedEvent.event_id` (unambiguous — `event_id` is the started row's
// own id) and picking the SHORTEST candidate duration when several
// share that `event_id` (a same-length-or-longer sibling match is
// always at least as safe a lower bound as the true duration). A
// follow-up ingester task should widen `span-pairs.sql`'s pairing key
// to include the action's `(branch, actionIndex)`.

import type {
  IRunEvent,
  IRunSpan,
} from "../../../../core/services/run-view.service";
import type { IWorkflowDefinitionDto } from "../../../automation/workflows/services/workflow-api.service";
import type {
  ActionStatus,
  IActionStep,
  IConditionalBranchNode,
  IConditionalStep,
  IForkLane,
  IForkStep,
  IMergedRun,
  ITimeRange,
  IWorkflowBranchAction,
  IWorkflowConditionalAction,
  StepColor,
  StepNode,
  WorkflowActionInput,
} from "./run-view.model";

const STEP_EVENT_KINDS: ReadonlySet<string> = new Set([
  "action_started",
  "action_completed",
  "condition_evaluated",
]);

const STEP_STATUS_FAILED = "failed";

/** amber = decisions, purple = agent, teal = channel, gray/platform =
 * everything else — DESIGN-run-view.md's color table, cited verbatim
 * (T03 assigns the semantic kind; T04 owns the actual CSS colors). */
function colorForActionType(actionType: string): StepColor {
  if (actionType === "agentCall") {
    return "agent";
  }
  if (actionType === "channelSend") {
    return "channel";
  }
  return "platform";
}

/** Mirrors `workflows.ts`'s `combineBranchLabel` exactly — the run's
 * emitted `branch` field on nested action events is built the same way. */
function combineBranchLabel(outer: string | null, inner: string): string {
  return outer ? `${outer}/${inner}` : inner;
}

function keyFor(branchPath: string | null, actionIndex: number): string {
  return `${branchPath ?? ""}::${actionIndex}`;
}

interface ActionEventPair {
  readonly started?: IRunEvent;
  readonly completed?: IRunEvent;
}

function indexActionEvents(
  events: readonly IRunEvent[]
): ReadonlyMap<string, ActionEventPair> {
  const map = new Map<string, ActionEventPair>();
  for (const event of events) {
    if (event.kind !== "action_started" && event.kind !== "action_completed") {
      continue;
    }
    if (event.payload_action_index === null) {
      continue;
    }
    const key = keyFor(event.payload_branch, event.payload_action_index);
    const existing = map.get(key) ?? {};
    map.set(
      key,
      event.kind === "action_started"
        ? { ...existing, started: event }
        : { ...existing, completed: event }
    );
  }
  return map;
}

/** `condition_evaluated` events carry NO `branch` field (see
 * `execution-completed-publisher.activity.ts`'s header — it is a
 * sibling hop off `execution_started`, not chained to its own
 * conditional's action events), so they cannot be matched by
 * `(branchPath, actionIndex)` alone. Grouped by `actionIndex` only and
 * consumed FIFO in the SAME depth-first, pre-order walk `runWorkflow`
 * actually executes in — the outer conditional's own event is always
 * emitted (and consumed) before a nested conditional sharing the same
 * `actionIndex` value is even reached. */
function indexConditionEvents(
  events: readonly IRunEvent[]
): Map<number, IRunEvent[]> {
  const map = new Map<number, IRunEvent[]>();
  for (const event of events) {
    if (
      event.kind !== "condition_evaluated" ||
      event.payload_action_index === null
    ) {
      continue;
    }
    const list = map.get(event.payload_action_index) ?? [];
    list.push(event);
    map.set(event.payload_action_index, list);
  }
  return map;
}

function timeRangeFromSpan(
  startedEvent: IRunEvent | undefined,
  spans: readonly IRunSpan[]
): { range: ITimeRange; durationMs: number | null } {
  if (!startedEvent) {
    return { range: { startedAt: null, completedAt: null }, durationMs: null };
  }
  const candidates = spans.filter(
    (span) => span.event_id === startedEvent.event_id
  );
  if (candidates.length === 0) {
    return { range: { startedAt: null, completedAt: null }, durationMs: null };
  }
  // Cartesian-pairing ambiguity (see this file's header) — the shortest
  // NON-NEGATIVE candidate is the safest lower-bound duration. A cross-
  // paired candidate (a `completed` row from a DIFFERENT action sharing
  // this run's `entity_id`/`kind_prefix`) can have `completed_at` earlier
  // than `started_at`, producing a negative `duration_ms` — that value is
  // never a real duration, so it is excluded rather than picked as the
  // "shortest" (run-view visual rewrite slice 2, negative-duration guard).
  // When every candidate is negative, no safe duration/range exists.
  const nonNegative = candidates.filter((span) => span.duration_ms >= 0);
  if (nonNegative.length === 0) {
    return { range: { startedAt: null, completedAt: null }, durationMs: null };
  }
  const chosen = nonNegative.reduce((min, span) =>
    span.duration_ms < min.duration_ms ? span : min
  );
  return {
    range: { startedAt: chosen.started_at, completedAt: chosen.completed_at },
    durationMs: chosen.duration_ms,
  };
}

function statusFromPair(pair: ActionEventPair | undefined): ActionStatus {
  if (!pair || (!pair.started && !pair.completed)) {
    return "not_executed";
  }
  if (pair.completed?.payload_step_status === STEP_STATUS_FAILED) {
    return "failed";
  }
  return "ok";
}

function instanceIdFromPair(pair: ActionEventPair | undefined): string | null {
  const source = pair?.completed ?? pair?.started;
  return source?.payload_connector_id ?? source?.payload_agent_id ?? null;
}

interface WalkContext {
  readonly actionEventsByKey: ReadonlyMap<string, ActionEventPair>;
  readonly conditionEventsByIndex: Map<number, IRunEvent[]>;
  readonly spans: readonly IRunSpan[];
}

function isBranchAction(
  action: WorkflowActionInput
): action is IWorkflowBranchAction {
  return action.activity === "branch";
}

function isConditionalAction(
  action: WorkflowActionInput
): action is IWorkflowConditionalAction {
  return action.activity === "conditional";
}

/** `IWorkflowBranchAction`'s lanes are every own-enumerable key except
 * `activity`/`name` (see `packages/shared/src/workflow.interfaces.ts`),
 * enumerated in the SAME `Object.entries` order `workflows.ts`'s
 * `executeAction` "branch" case uses to build `branchEntries`. */
function laneEntriesOf(
  action: IWorkflowBranchAction
): Array<[string, WorkflowActionInput[]]> {
  return Object.entries(action).filter(
    (entry): entry is [string, WorkflowActionInput[]] =>
      entry[0] !== "activity" && entry[0] !== "name"
  );
}

function buildActionStep(
  action: WorkflowActionInput,
  actionIndex: number,
  branchPath: string | null,
  nestingDepth: number,
  ctx: WalkContext
): IActionStep {
  const pair = ctx.actionEventsByKey.get(keyFor(branchPath, actionIndex));
  const { range, durationMs } = timeRangeFromSpan(pair?.started, ctx.spans);
  return {
    type: "action",
    actionIndex,
    branchPath,
    nestingDepth,
    actionType: action.activity,
    name: action.name,
    color: colorForActionType(action.activity),
    status: statusFromPair(pair),
    instanceId: instanceIdFromPair(pair),
    durationMs,
    ...range,
  };
}

function buildForkStep(
  action: IWorkflowBranchAction,
  actionIndex: number,
  branchPath: string | null,
  nestingDepth: number,
  ctx: WalkContext
): IForkStep {
  const pair = ctx.actionEventsByKey.get(keyFor(branchPath, actionIndex));
  const { range, durationMs } = timeRangeFromSpan(pair?.started, ctx.spans);
  const lanes: IForkLane[] = laneEntriesOf(action).map(
    ([label, laneActions]) => ({
      label,
      steps: walkActions(
        laneActions,
        combineBranchLabel(branchPath, label),
        nestingDepth + 1,
        ctx
      ),
    })
  );
  return {
    type: "fork",
    actionIndex,
    branchPath,
    nestingDepth,
    name: action.name,
    color: "platform",
    status: statusFromPair(pair),
    durationMs,
    lanes,
    ...range,
  };
}

function buildConditionalStep(
  action: IWorkflowConditionalAction,
  actionIndex: number,
  branchPath: string | null,
  nestingDepth: number,
  ctx: WalkContext
): IConditionalStep {
  const queue = ctx.conditionEventsByIndex.get(actionIndex);
  const conditionEvent = queue && queue.length > 0 ? queue.shift() : undefined;

  const branches: IConditionalBranchNode[] = action.branches.map((branch) => ({
    label: branch.label,
    taken: conditionEvent?.payload_branch_taken === branch.label,
    steps: walkActions(
      branch.actions,
      combineBranchLabel(branchPath, branch.label),
      nestingDepth + 1,
      ctx
    ),
  }));

  const hasDefault = Boolean(action.default && action.default.length > 0);
  if (hasDefault && action.default) {
    branches.push({
      label: "default",
      taken: conditionEvent?.payload_branch_taken === "default",
      steps: walkActions(
        action.default,
        combineBranchLabel(branchPath, "default"),
        nestingDepth + 1,
        ctx
      ),
    });
  }

  const occurredAt = conditionEvent?.occurred_at ?? null;
  return {
    type: "conditional",
    actionIndex,
    branchPath,
    nestingDepth,
    name: action.name,
    color: "decision",
    executed: Boolean(conditionEvent),
    expression: conditionEvent?.payload_expression ?? null,
    evaluatedValue: conditionEvent?.payload_evaluated_value ?? null,
    branchTaken: conditionEvent?.payload_branch_taken ?? null,
    hasDefault,
    branches,
    startedAt: occurredAt,
    completedAt: occurredAt,
    conditionEventId: conditionEvent?.event_id ?? null,
  };
}

function walkActions(
  actions: readonly WorkflowActionInput[],
  branchPath: string | null,
  nestingDepth: number,
  ctx: WalkContext
): StepNode[] {
  return actions.map((action, index) => {
    if (isBranchAction(action)) {
      return buildForkStep(action, index, branchPath, nestingDepth, ctx);
    }
    if (isConditionalAction(action)) {
      return buildConditionalStep(action, index, branchPath, nestingDepth, ctx);
    }
    return buildActionStep(action, index, branchPath, nestingDepth, ctx);
  });
}

/** Builds one flat (unnested) `IActionStep` straight from a run's OWN
 * events — no definition available to supply structural (fork/conditional
 * plan) context. Used by `buildStepsFromEvents`'s events-only fallback
 * (see that function's header). `actionType`/`name` fall back to
 * `"unknown"`/the action type itself when the payload is missing them
 * (should not happen for a well-formed `action_started` row, but the
 * fallback keeps this defensive rather than throwing). */
function buildActionStepFromEvents(
  pair: ActionEventPair,
  spans: readonly IRunSpan[]
): IActionStep {
  const source = pair.started ?? pair.completed;
  const actionType = source?.payload_action_type ?? "unknown";
  const name = source?.payload_action_name ?? actionType;
  const { range, durationMs } = timeRangeFromSpan(pair.started, spans);
  return {
    type: "action",
    actionIndex: source?.payload_action_index ?? 0,
    branchPath: source?.payload_branch ?? null,
    nestingDepth: 0,
    actionType,
    name,
    color: colorForActionType(actionType),
    status: statusFromPair(pair),
    instanceId: instanceIdFromPair(pair),
    durationMs,
    ...range,
  };
}

/** Builds one `IConditionalStep` straight from a single `condition_evaluated`
 * event — no definition, so no declared branches/default exist to walk
 * (`branches: []`, `hasDefault: false`). `layout-run.ts` renders this as a
 * bare decision pill with the evaluated chip and no child lanes/edges. */
function buildConditionalStepFromEvent(event: IRunEvent): IConditionalStep {
  return {
    type: "conditional",
    actionIndex: event.payload_action_index ?? 0,
    branchPath: event.payload_branch,
    nestingDepth: 0,
    name: event.payload_expression ?? "condition",
    color: "decision",
    executed: true,
    expression: event.payload_expression,
    evaluatedValue: event.payload_evaluated_value,
    branchTaken: event.payload_branch_taken,
    hasDefault: false,
    branches: [],
    startedAt: event.occurred_at,
    completedAt: event.occurred_at,
    conditionEventId: event.event_id,
  };
}

/**
 * Events-only fallback for when NO workflow definition is available (T06
 * finding: the trace-detail "Run view" tab only has a Temporal workflowId,
 * not a definitionId). Builds a FLAT spine of the steps the run actually
 * EXECUTED, straight from its own events — no fork/conditional plan
 * reconstruction is possible without the definition, so every step comes
 * back at `nestingDepth: 0` and conditionals carry `branches: []` (no
 * not-executed siblings to show). Ordered by the step's own `occurred_at`
 * (an action step's `action_started` row, or the `condition_evaluated`
 * event itself) ascending, tiebroken by `actionIndex` — the definition-
 * driven `walkActions` path gets its order for free from the definition's
 * own array order; this path has no such array, so it derives order from
 * WHEN each step actually ran.
 */
function buildStepsFromEvents(
  events: readonly IRunEvent[],
  spans: readonly IRunSpan[]
): StepNode[] {
  const actionPairsByKey = indexActionEvents(events);
  const entries: Array<{ step: StepNode; occurredAt: string }> = [];

  for (const pair of actionPairsByKey.values()) {
    const source = pair.started ?? pair.completed;
    if (!source) {
      continue;
    }
    entries.push({
      step: buildActionStepFromEvents(pair, spans),
      occurredAt: source.occurred_at,
    });
  }

  for (const event of events) {
    if (event.kind !== "condition_evaluated") {
      continue;
    }
    entries.push({
      step: buildConditionalStepFromEvent(event),
      occurredAt: event.occurred_at,
    });
  }

  return entries
    .sort((a, b) => {
      const byTime = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
      if (byTime !== 0) {
        return byTime;
      }
      return a.step.actionIndex - b.step.actionIndex;
    })
    .map((entry) => entry.step);
}

/**
 * Builds the run's step tree from its definition, matched against the
 * run's OWN events/spans (already scoped by `to-run-response.ts`).
 * `definition.actions` is `unknown[]` on the wire
 * (`IWorkflowDefinitionDto`) — cast to `WorkflowActionInput[]` here, the one
 * place in the domain layer that asserts the shape, mirroring the
 * definition's own runtime contract (`packages/shared`).
 *
 * When no definition actions are available (T06: trace-detail's "Run view"
 * tab has no definitionId), falls back to `buildStepsFromEvents` — the
 * EXECUTED steps only, flat, no plan-vs-executed enrichment — rather than
 * an empty tree. `degraded` still only reflects "genuinely no step events
 * at all" (the old-run/artifact-only banner case), NOT "no definition":
 * a run with step events but no definition is a full (if flat) render.
 */
export function mergeRun(
  events: readonly IRunEvent[],
  spans: readonly IRunSpan[],
  definition: Pick<IWorkflowDefinitionDto, "actions">
): IMergedRun {
  const ctx: WalkContext = {
    actionEventsByKey: indexActionEvents(events),
    conditionEventsByIndex: indexConditionEvents(events),
    spans,
  };

  const actions = (definition.actions ?? []) as WorkflowActionInput[];
  const hasStepEvents = events.some(
    (event) => event.kind !== null && STEP_EVENT_KINDS.has(event.kind)
  );

  const steps =
    actions.length > 0
      ? walkActions(actions, null, 0, ctx)
      : hasStepEvents
        ? buildStepsFromEvents(events, spans)
        : [];

  return { steps, degraded: !hasStepEvents };
}
