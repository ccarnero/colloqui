import { proxyActivities, uuid4, workflowInfo } from "@temporalio/workflow";
import type {
  AgentCallArgs,
  ChannelSendArgs,
  ConditionComparator,
  EndpointCallArgs,
  EventCausalContext,
  JsFunctionArgs,
  McpCallArgs,
  ServiceBusCallArgs,
  ServiceCallArgs,
  WorkflowAction,
  WorkflowDefinition,
  WorkflowExecutionContext,
} from "@yoizen/shared";
import type { ConditionalAction, IConditionalBranch } from "./workflow.types";
import { CONNECTOR_RUNTIME_TASK_QUEUE } from "./workflow-queue";

interface IOrchestratorActivities {
  executeJsFunction(
    args: JsFunctionArgs,
    context: WorkflowExecutionContext
  ): Promise<unknown>;
  executeServiceBusCall(
    args: ServiceBusCallArgs,
    tenantId: string,
    causal?: EventCausalContext,
    executionId?: string
  ): Promise<{ published: true; subject: string }>;
  executeChannelSend(
    args: ChannelSendArgs,
    tenantId: string,
    causal?: EventCausalContext,
    executionId?: string
  ): Promise<{ published: true; subject: string }>;
}

/** Shared shape for action_started/action_completed activity args (T03). */
interface IActionEventArgs {
  executionId: string;
  actionIndex: number;
  actionType: string;
  actionName: string;
  branch?: string;
  connectorId?: string;
  agentId?: string;
  tenantId: string;
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}

interface IExecutionPublisherActivities {
  publishExecutionCompletedEvent(args: {
    executionId: string;
    status: string;
    tenantId: string;
    workflowName?: string;
    correlationId?: string;
    causationId?: string | null;
    depth?: number;
  }): Promise<void>;
  publishExecutionStartedEvent(args: {
    executionId: string;
    workflowId: string;
    runId: string;
    tenantId: string;
    workflowName?: string;
    correlationId?: string;
    causationId?: string | null;
    depth?: number;
    /** Pre-generated via `uuid4()` so the workflow knows the id up front (T03). */
    eventId?: string;
  }): Promise<void>;
  publishActionStartedEvent(args: IActionEventArgs): Promise<void>;
  publishActionCompletedEvent(
    args: IActionEventArgs & {
      status: "ok" | "failed" | "skipped";
      errorClass?: string;
    }
  ): Promise<void>;
  publishConditionEvaluatedEvent(args: {
    executionId: string;
    actionIndex: number;
    expression: string;
    evaluatedValue: string;
    branchTaken: string | null;
    cases: string[];
    truncated?: boolean;
    tenantId: string;
    correlationId?: string;
    causationId?: string | null;
    depth?: number;
  }): Promise<void>;
}

interface IHttpActivities {
  executeEndpointCall(
    args: EndpointCallArgs,
    tenantId: string,
    executionId?: string
  ): Promise<{
    status: number;
    data: unknown;
    headers: Record<string, string>;
  }>;
  executeServiceCall(
    args: ServiceCallArgs,
    tenantId: string,
    executionId?: string
  ): Promise<{
    status: number;
    data: unknown;
    headers: Record<string, string>;
  }>;
  executeMcpCall(
    args: McpCallArgs,
    tenantId: string,
    causal?: EventCausalContext,
    executionId?: string
  ): Promise<{
    toolName: string;
    result: unknown;
    isError: boolean;
    durationMs: number;
  }>;
}

/** YoizenClaw chat can exceed default HTTP activity timeouts. */
interface IAgentHttpActivities {
  executeAgentCall(
    args: AgentCallArgs,
    tenantId: string,
    executionId?: string,
    agentTimeoutMs?: number,
    causal?: EventCausalContext
  ): Promise<{
    status: number;
    data: unknown;
    headers: Record<string, string>;
  }>;
}

const local = proxyActivities<IOrchestratorActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
});

const publisher = proxyActivities<IExecutionPublisherActivities>({
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 2 },
});

// HTTP activity retry policy: sized to ride out at least one full
// circuit-breaker cooldown window without giving up. The
// `workflow-http` activities throw `CIRCUIT_OPEN` as a RETRYABLE
// failure with `nextRetryDelay = HTTP_BREAKER_COOLDOWN_MS (30s)`,
// which Temporal honours over the policy's exponential backoff —
// so a typical cold-start sequence is:
//   attempt 1 (t=0)  -> DENY (CIRCUIT_OPEN), wait 30s
//   attempt 2 (t=30s) -> HALF_OPEN probe, usually succeeds.
// `maximumAttempts: 5` is the safety net for back-to-back trips
// (e.g. a flapping downstream during a stress ramp), capped by
// `maximumInterval: "30s"` so we never wait longer than one cooldown.
const http = proxyActivities<IHttpActivities>({
  taskQueue: CONNECTOR_RUNTIME_TASK_QUEUE,
  startToCloseTimeout: "30s",
  retry: {
    maximumAttempts: 5,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "30s",
  },
});

// Agent activity uses the agent breaker (60s cooldown). Same
// reasoning as `http`, but `maximumInterval` matches the agent
// breaker's longer cooldown.
const httpAgent = proxyActivities<IAgentHttpActivities>({
  startToCloseTimeout: "15m",
  heartbeatTimeout: "30s",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumInterval: "60s",
  },
});

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;

function resolvePath(context: WorkflowExecutionContext, path: string): unknown {
  const segments = path.trim().split(".");
  let current: unknown = context;
  for (let i = 0; i < segments.length; i++) {
    if (current == null || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[segments[i]];
  }
  return current ?? "";
}

/**
 * Like resolvePath but returns the raw value (undefined/null when absent)
 * instead of coercing to "". Used by conditional evaluation where
 * exists/notExists need to distinguish between missing and present values.
 */
function resolvePathRaw(
  context: WorkflowExecutionContext,
  path: string
): unknown {
  const segments = path.trim().split(".");
  let current: unknown = context;
  for (let i = 0; i < segments.length; i++) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segments[i]];
  }
  return current;
}

function resolveTemplates<T>(value: T, context: WorkflowExecutionContext): T {
  if (typeof value === "string") {
    return value.replace(TEMPLATE_RE, (_, path: string) =>
      String(resolvePath(context, path))
    ) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplates(v, context)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < entries.length; i++) {
      out[entries[i][0]] = resolveTemplates(entries[i][1], context);
    }
    return out as T;
  }
  return value;
}

async function executeActions(
  actions: WorkflowAction[],
  context: ExtendedContext,
  branchLabel?: string
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const result = await executeActionWithTelemetry(
      actions[i],
      context,
      i,
      branchLabel
    );
    context.results[actions[i].name] = result;
    context.variables.previous = (result ?? {}) as Record<string, unknown>;
    context.variables.node[actions[i].name] = (result ?? {}) as Record<
      string,
      unknown
    >;
  }
}

/**
 * Combines an outer branch label with an inner one for actions nested
 * inside a fork-inside-condition (or condition-inside-fork) chain, so
 * `action_started.branch` always reflects the full path
 * (`"pathA/approved"`), not just the innermost label.
 */
function combineBranchLabel(outer: string | undefined, inner: string): string {
  return outer ? `${outer}/${inner}` : inner;
}

function evaluateCondition(
  left: unknown,
  comparator: ConditionComparator,
  right: unknown
): boolean {
  if (comparator === "exists") {
    return left !== undefined && left !== null;
  }
  if (comparator === "notExists") {
    return left === undefined || left === null;
  }

  if (
    comparator === "gt" ||
    comparator === "lt" ||
    comparator === "gte" ||
    comparator === "lte"
  ) {
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (isNaN(leftNum) || isNaN(rightNum)) {
      return false;
    }
    switch (comparator) {
      case "gt":
        return leftNum > rightNum;
      case "lt":
        return leftNum < rightNum;
      case "gte":
        return leftNum >= rightNum;
      case "lte":
        return leftNum <= rightNum;
    }
  }

  const leftStr = String(left ?? "");
  const rightStr = String(right ?? "");

  switch (comparator) {
    case "eq":
      return leftStr === rightStr;
    case "neq":
      return leftStr !== rightStr;
    case "contains":
      return leftStr.includes(rightStr);
    default:
      return false;
  }
}

/**
 * Mutable, shared-by-reference bookkeeping for the step-event volume
 * guard (T03 SPEC constraint: "cap with a `truncated` marker event
 * rather than unbounded emission"). Shared (not cloned) across `branch`
 * sub-contexts so the 100-event cap applies to the WHOLE run, not
 * per-branch.
 */
interface StepEventState {
  /** Total action_started + action_completed events emitted so far. */
  count: number;
  /** True once the truncated marker has fired — all further actions emit nothing. */
  truncated: boolean;
}

const STEP_EVENT_CAP = 100;

/**
 * Per-run step-event telemetry context, computed once in `runWorkflow`
 * when `executionId` is set (best-effort — absent when
 * `publishExecutionStartedEvent` itself failed or executionId is
 * missing, in which case no action telemetry is emitted at all,
 * mirroring the existing execution_started/completed gate).
 */
interface StepEventContext {
  executionId: string;
  tenantId: string;
  /** Fixed causal context shared by EVERY action_started/completed in this run (see design note in runWorkflow). */
  actionCausal: EventCausalContext;
  state: StepEventState;
}

/**
 * Extended context that includes agentTimeoutMs on the workflow
 * property. Used internally so agentCall can read the per-execution
 * timeout without widening the shared WorkflowExecutionContext.
 */
type ExtendedContext = WorkflowExecutionContext & {
  workflow: {
    name: string;
    tenant: string;
    application: string;
    agentTimeoutMs?: number;
  };
  /** T03 step-event telemetry — undefined means "do not emit". */
  stepEvents?: StepEventContext;
};

/**
 * Instance references for action_started/completed telemetry (SPEC:
 * "connectorId/agentId when applicable"). Mapped from each activity's
 * real argument shape (`@yoizen/shared` `workflow.interfaces.ts`):
 * `endpointCall`/`serviceCall`/`mcpCall` target an external instance
 * (adapter, internal service, or MCP server respectively) and report
 * it as `connectorId`; `agentCall` reports `agentId`. Other activity
 * types (`jsFunction`, `serviceBusCall`, `channelSend`, `branch`,
 * `conditional`) have no such reference.
 */
function extractInstanceRefs(action: WorkflowAction): {
  connectorId?: string;
  agentId?: string;
} {
  switch (action.activity) {
    case "endpointCall":
      return action.args.adapterId
        ? { connectorId: action.args.adapterId }
        : {};
    case "serviceCall": {
      const ref = action.args.serviceSlug ?? action.args.serviceId;
      return ref ? { connectorId: ref } : {};
    }
    case "mcpCall":
      return { connectorId: action.args.serverId };
    case "agentCall":
      return { agentId: action.args.agentId };
    default:
      return {};
  }
}

/**
 * Decides whether this action's telemetry should be emitted, replaced
 * by the single `truncated` marker, or skipped entirely (volume guard,
 * SPEC constraint: total step events for a run must never exceed
 * `STEP_EVENT_CAP`, INCLUDING the marker itself). Each action
 * contributes up to 2 events (started + completed); pairs keep
 * emitting only while there is still room left over for a potential
 * future marker (`STEP_EVENT_CAP - 1` reserved budget) — once that
 * would be exceeded, a SINGLE `truncated` marker fires instead
 * (reusing `action_completed` with `actionType: "truncated"`,
 * `status: "skipped"` — the least invasive design, needs no new
 * TAXONOMY kind) and every subsequent action emits nothing.
 *
 * ATOMIC RESERVATION (concurrency fix): `branch` children share a
 * single `stepEvents.state` object BY REFERENCE and run concurrently
 * via `Promise.all` (see the `branch` case in `executeAction`).
 * Temporal's workflow sandbox is single-threaded, so each sibling
 * runs synchronously up to its own first `await`. If the decision
 * (read `state.count`/`state.truncated`) and the mutation
 * (`state.count += ...` / `state.truncated = true`) were split
 * across an `await` boundary, two siblings could both read the same
 * stale `count`, both decide "emit" (blowing the `>100` cap) or both
 * decide "truncated-marker" (publishing more than one marker). This
 * function is therefore the ONLY place allowed to touch
 * `state.count`/`state.truncated`: it decides AND reserves the full
 * event budget for the action (2 slots for started+completed, 1 slot
 * for the truncated marker) in one synchronous call, before the
 * caller ever awaits a publish. Callers must not increment the
 * counters themselves — a failed publish does not roll back the
 * reservation (best-effort telemetry: a lost event still counts
 * against the cap, which only pushes the run further under the cap,
 * never over it).
 *
 * `cost` (T04, `manual-loops/workflow-step-events.md`): generalizes
 * the reservation beyond the action started+completed PAIR (cost 2,
 * the default) so `condition_evaluated` — a SINGLE step event per
 * `conditional` node, emitted alongside (not instead of) that node's
 * own action_started/completed pair — can reserve exactly 1 slot
 * through the SAME atomic decision+mutation critical section. The
 * truncated-marker slot itself always costs 1, regardless of the
 * caller's requested cost, since only one marker ever fires per run.
 */
function reserveStepEmission(
  state: StepEventState,
  cost: 1 | 2 = 2
): "emit" | "truncated-marker" | "skip" {
  if (state.truncated) {
    return "skip";
  }
  if (state.count + cost > STEP_EVENT_CAP - 1) {
    // Reserve the single truncated-marker slot synchronously — no
    // other sibling can observe count/truncated between this read
    // and this write because there is no await in between.
    state.count += 1;
    state.truncated = true;
    return "truncated-marker";
  }
  // Reserve the full requested cost up front so a concurrent sibling
  // reading count immediately after this synchronous call sees the
  // full cost of this event already accounted for, even though the
  // publish itself is still separated by an await.
  state.count += cost;
  return "emit";
}

/** SPEC decision 3: `evaluatedValue` is the scalar/short value only. */
const EVALUATED_VALUE_MAX_LENGTH = 256;

/**
 * Stringifies + truncates the raw evaluated left-hand value for
 * `condition_evaluated` (T04). Mirrors `evaluateCondition`'s own
 * `String(left ?? "")` coercion so the reported value matches what
 * was actually compared, never the full variable scope (SPEC
 * decision 3).
 */
function truncateEvaluatedValue(value: unknown): {
  value: string;
  truncated: boolean;
} {
  const str = String(value ?? "");
  if (str.length > EVALUATED_VALUE_MAX_LENGTH) {
    return { value: str.slice(0, EVALUATED_VALUE_MAX_LENGTH), truncated: true };
  }
  return { value: str, truncated: false };
}

/**
 * Emits `condition_evaluated` (T04) for a `conditional` node's
 * evaluation. Fires ONCE per node (not per branch tested) — the
 * expression/value reported are whichever branch's LEFT value decided
 * the outcome (the matched branch, or the first-declared branch when
 * nothing matched, mirroring a switch's subject expression). Reuses
 * `reserveStepEmission`'s atomic reservation (cost 1) and the SAME
 * truncated-marker fallback as action events — the volume cap is
 * run-wide, not per-kind.
 *
 * Causal design (SPEC decision 2, consistent with T03): causation_id
 * is the run's `execution_started` event id and depth matches action
 * events — condition_evaluated is a SIBLING hop off execution_started,
 * not chained to the conditional node's own action_started/completed.
 */
async function emitConditionEvaluatedTelemetry(
  context: ExtendedContext,
  actionIndex: number,
  expression: string,
  rawEvaluatedValue: unknown,
  branchTaken: string | null,
  cases: string[]
): Promise<void> {
  const stepEvents = context.stepEvents;
  if (!stepEvents) {
    return;
  }

  const emission = reserveStepEmission(stepEvents.state, 1);
  if (emission === "skip") {
    return;
  }

  const baseArgs = {
    executionId: stepEvents.executionId,
    actionIndex,
    tenantId: stepEvents.tenantId,
    correlationId: stepEvents.actionCausal.correlation_id,
    causationId: stepEvents.actionCausal.causation_id,
    depth: stepEvents.actionCausal.depth,
  };

  if (emission === "truncated-marker") {
    try {
      await publisher.publishActionCompletedEvent({
        ...baseArgs,
        actionType: "truncated",
        actionName: "truncated",
        status: "skipped",
      });
    } catch (_) {
      // Best-effort: reservation already committed synchronously above.
    }
    return;
  }

  const { value: evaluatedValue, truncated } =
    truncateEvaluatedValue(rawEvaluatedValue);

  try {
    await publisher.publishConditionEvaluatedEvent({
      ...baseArgs,
      expression,
      evaluatedValue,
      branchTaken,
      cases,
      ...(truncated && { truncated }),
    });
  } catch (_) {
    // Best-effort: a telemetry gap must never block the workflow.
  }
}

async function executeActionWithTelemetry(
  action: WorkflowAction,
  context: ExtendedContext,
  actionIndex: number,
  branchLabel: string | undefined
): Promise<unknown> {
  const stepEvents = context.stepEvents;
  if (!stepEvents) {
    return executeAction(action, context, branchLabel, actionIndex);
  }

  // Reserve the decision + counter/flag mutation SYNCHRONOUSLY, before
  // any await below. This is the single critical section: concurrent
  // `branch` siblings sharing `stepEvents.state` by reference can only
  // interleave at an `await`, so by the time we hit our first `await`
  // the reservation for THIS action is already committed and visible
  // to every other sibling's next `reserveStepEmission` call.
  const emission = reserveStepEmission(stepEvents.state);
  if (emission === "skip") {
    return executeAction(action, context, branchLabel, actionIndex);
  }

  const instanceRefs = extractInstanceRefs(action);
  const baseArgs = {
    executionId: stepEvents.executionId,
    actionIndex,
    tenantId: stepEvents.tenantId,
    correlationId: stepEvents.actionCausal.correlation_id,
    causationId: stepEvents.actionCausal.causation_id,
    depth: stepEvents.actionCausal.depth,
    ...(branchLabel !== undefined && { branch: branchLabel }),
    ...instanceRefs,
  };

  if (emission === "truncated-marker") {
    try {
      await publisher.publishActionCompletedEvent({
        ...baseArgs,
        actionType: "truncated",
        actionName: "truncated",
        status: "skipped",
      });
    } catch (_) {
      // Best-effort: a telemetry gap must never block the workflow.
      // The reservation above is NOT rolled back on publish failure —
      // the slot stays spent, which only makes the run's emitted
      // total further under the cap, never over it.
    }
    return executeAction(action, context, branchLabel, actionIndex);
  }

  try {
    await publisher.publishActionStartedEvent({
      ...baseArgs,
      actionType: action.activity,
      actionName: action.name,
    });
  } catch (_) {
    // Best-effort: reservation already committed synchronously above,
    // intentionally not rolled back on failure (see reserveStepEmission).
  }

  try {
    const result = await executeAction(
      action,
      context,
      branchLabel,
      actionIndex
    );
    try {
      await publisher.publishActionCompletedEvent({
        ...baseArgs,
        actionType: action.activity,
        actionName: action.name,
        status: "ok",
      });
    } catch (_) {
      /* best-effort: a telemetry gap must never block the workflow */
    }
    return result;
  } catch (err) {
    try {
      await publisher.publishActionCompletedEvent({
        ...baseArgs,
        actionType: action.activity,
        actionName: action.name,
        status: "failed",
        // Error CLASS NAME only — never a stack trace (SPEC constraint).
        errorClass:
          err instanceof Error ? err.constructor.name : "UnknownError",
      });
    } catch (_) {
      /* best-effort: a telemetry gap must never block the workflow */
    }
    throw err;
  }
}

async function executeAction(
  action: WorkflowAction,
  context: ExtendedContext,
  branchLabel?: string,
  /**
   * 0-based position of `action` within its OWN action list (T04):
   * threaded through so the `conditional` case can cite it on the
   * `condition_evaluated` event, matching the SAME `actionIndex` the
   * conditional node's own action_started/completed pair already
   * reports. Only `conditional` uses it today.
   */
  actionIndex?: number
): Promise<unknown> {
  const tenant = context.workflow.tenant;

  switch (action.activity) {
    case "endpointCall":
      return http.executeEndpointCall(
        resolveTemplates(action.args, context),
        tenant,
        context.executionId
      );

    case "jsFunction":
      return local.executeJsFunction(
        resolveTemplates(action.args, context),
        context
      );

    case "serviceBusCall":
      return local.executeServiceBusCall(
        resolveTemplates(action.args, context),
        tenant,
        context.causal,
        context.executionId
      );

    case "channelSend":
      return local.executeChannelSend(
        resolveTemplates(action.args, context),
        tenant,
        context.causal,
        context.executionId
      );

    case "serviceCall":
      return http.executeServiceCall(
        resolveTemplates(action.args, context),
        tenant,
        context.executionId
      );

    case "mcpCall":
      return http.executeMcpCall(
        resolveTemplates(action.args, context),
        tenant,
        context.causal,
        context.executionId
      );

    case "agentCall": {
      const resolvedArgs = resolveTemplates(action.args, context);
      const result = await httpAgent.executeAgentCall(
        { ...resolvedArgs, variables: context.variables },
        tenant,
        context.executionId,
        context.workflow.agentTimeoutMs,
        context.causal
      );
      /**
       * Correlation-chain fix 3: when the activity reports the id of the
       * agent's `execution_completed` bus event, subsequent publications
       * cite it as causation instead of the frozen trigger context. Only
       * rederived when a causal context already exists — causal roots
       * never claim a hop, and on rootless runs the completed event's
       * correlation belongs to a different (fallback) group.
       */
      const completedEventId = result.headers["x-yoizen-completed-event-id"];
      if (context.causal && typeof completedEventId === "string") {
        const completedDepth = Number.parseInt(
          result.headers["x-yoizen-completed-event-depth"] ?? "",
          10
        );
        context.causal = {
          causation_id: completedEventId,
          correlation_id: context.causal.correlation_id,
          // Fallback mirrors the publish path: requested = trigger depth
          // + 1, completed = requested + 1.
          depth: Number.isFinite(completedDepth)
            ? completedDepth
            : context.causal.depth + 2,
        };
      }
      return result;
    }

    case "branch": {
      const branchEntries: Array<[string, WorkflowAction[]]> = [];
      const keys = Object.keys(action);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "activity" || key === "name") {
          continue;
        }
        branchEntries.push([
          key,
          (action as Record<string, unknown>)[key] as WorkflowAction[],
        ]);
      }

      const branchResults = await Promise.all(
        branchEntries.map(async ([name, branchActions]) => {
          const branchCtx: ExtendedContext = {
            workflow: context.workflow,
            request: context.request,
            results: { ...context.results },
            variables: {
              system: context.variables.system,
              workflow: context.variables.workflow,
              previous: context.variables.previous,
              node: { ...context.variables.node },
              request: context.variables.request,
            },
            ...(context.causal && { causal: context.causal }),
            ...(context.executionId && { executionId: context.executionId }),
            // Shared BY REFERENCE (not cloned) — the volume cap and
            // action_started/completed causal context apply to the
            // WHOLE run, not per-branch.
            ...(context.stepEvents && { stepEvents: context.stepEvents }),
          };
          await executeActions(
            branchActions,
            branchCtx,
            combineBranchLabel(branchLabel, name)
          );
          return {
            results: branchCtx.results,
            nodeVars: branchCtx.variables.node,
            previousVar: branchCtx.variables.previous,
          };
        })
      );

      for (let i = 0; i < branchResults.length; i++) {
        Object.assign(context.results, branchResults[i]!.results);
        Object.assign(context.variables.node, branchResults[i]!.nodeVars);
      }
      return branchEntries.map(([name]) => name);
    }

    case "conditional": {
      const condAction = action as ConditionalAction;
      // T04 `condition_evaluated` payload's `cases`: declared case
      // labels in definition order — independent of which one matched.
      const cases = condAction.branches.map((b) => b.label);
      const resolvedActionIndex = actionIndex ?? 0;

      // T04: the node's reported expression/value are the FIRST
      // declared branch's — well-formed multi-case definitions test
      // the SAME variable across branches (SPEC "evaluó: 320 → caso
      // 100–500"), so branch[0] is the node's representative "switch
      // subject" even when a LATER branch matches (that branch's own
      // left value is used instead in that case, see below). Captured
      // from the loop's own evaluation (i === 0) — NOT a second
      // resolvePathRaw call — so the evaluation itself never moves.
      let firstBranchExpression: string | undefined;
      let firstBranchValue: unknown;

      for (let i = 0; i < condAction.branches.length; i++) {
        const branch: IConditionalBranch = condAction.branches[i];
        const leftValue = resolvePathRaw(context, branch.condition.variable);
        const rightValue = resolveTemplates(branch.condition.value, context);

        if (i === 0) {
          firstBranchExpression = `{{${branch.condition.variable}}}`;
          firstBranchValue = leftValue;
        }

        if (
          evaluateCondition(leftValue, branch.condition.comparator, rightValue)
        ) {
          await emitConditionEvaluatedTelemetry(
            context,
            resolvedActionIndex,
            `{{${branch.condition.variable}}}`,
            leftValue,
            branch.label,
            cases
          );
          await executeActions(
            branch.actions,
            context,
            combineBranchLabel(branchLabel, branch.label)
          );
          return { matchedBranch: branch.label };
        }
      }

      if (condAction.default && condAction.default.length > 0) {
        await emitConditionEvaluatedTelemetry(
          context,
          resolvedActionIndex,
          firstBranchExpression ?? "",
          firstBranchValue,
          "default",
          cases
        );
        await executeActions(
          condAction.default,
          context,
          combineBranchLabel(branchLabel, "default")
        );
        return { matchedBranch: "default" };
      }

      // If-without-else evaluating false (or no branch matched and no
      // default): branchTaken null (SPEC constraint). The skipped
      // branch's own actions emit NOTHING — they never run
      // executeActionWithTelemetry at all (not executed = no event).
      await emitConditionEvaluatedTelemetry(
        context,
        resolvedActionIndex,
        firstBranchExpression ?? "",
        firstBranchValue,
        null,
        cases
      );
      return { matchedBranch: null };
    }

    default: {
      const activity = (action as WorkflowAction).activity;
      throw new Error(`Unsupported workflow activity: ${String(activity)}`);
    }
  }
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
  executionId?: string,
  systemVariables?: Record<string, unknown>
): Promise<WorkflowExecutionContext> {
  const context: ExtendedContext = {
    workflow: {
      name: workflow.name,
      tenant: workflow.tenant,
      application: workflow.application,
      ...(workflow.agentTimeoutMs !== undefined && {
        agentTimeoutMs: workflow.agentTimeoutMs,
      }),
    },
    request: workflow.request,
    results: {},
    variables: {
      system: systemVariables ?? {},
      workflow: workflow.variables ?? {},
      previous: {} as Record<string, unknown>,
      node: {} as Record<string, Record<string, unknown>>,
      request: workflow.request ?? {},
    },
    ...(executionId && { executionId }),
    ...(workflow.causal && { causal: workflow.causal }),
  };

  if (executionId) {
    try {
      const info = workflowInfo();
      // Generated up front (Temporal's deterministic `uuid4()`, safe in
      // workflow code — unlike `crypto.randomUUID()`) so it is known
      // BEFORE the publish activity runs: action_started/completed
      // events (below) cite it as their causation_id without a
      // round-trip through the activity's own id generation.
      const executionStartedEventId = uuid4();
      await publisher.publishExecutionStartedEvent({
        executionId,
        eventId: executionStartedEventId,
        workflowId: info.workflowId,
        runId: info.runId,
        tenantId: workflow.tenant,
        workflowName: workflow.name,
        /**
         * Depth math (MAX_DEPTH_BY_CATEGORY, packages/shared/src/envelope.utils.ts):
         * workflow-service publishes are `internal_service` category,
         * ceiling 5. `execution_started` is one hop off the trigger
         * (`context.causal.depth + 1`), same as `execution_completed`'s
         * base case — they are SIBLING hops off the same trigger, not
         * chained to each other, so this never compounds. Realistic
         * trigger depths from api-gateway/agent-admin-service land at
         * 0-2, so 0-2 + 1 = 1-3, comfortably under the ceiling of 5 even
         * before accounting for the agentCall rederivation (fix 3 below,
         * `completedDepth`) which only affects `execution_completed`,
         * not `execution_started` (emitted before any action runs).
         */
        ...(context.causal && {
          correlationId: context.causal.correlation_id,
          causationId: context.causal.causation_id,
          depth: context.causal.depth + 1,
        }),
      });

      /**
       * T03 action-event causal design (SPEC decision 2,
       * manual-loops/workflow-step-events.md): every
       * action_started/action_completed in this run cites THIS
       * execution_started event as its causation_id — a SIBLING hop
       * off execution_started, not chained action-to-action. This
       * keeps the depth CONSTANT no matter how many actions run (no
       * per-action growth), which is what makes the 100-event volume
       * cap safe: even a maximally-sized run never approaches
       * MAX_DEPTH_BY_CATEGORY.internal_service = 5.
       *
       * Depth math: trigger depth 0-2 → execution_started =
       * trigger+1 = 1-3 (see comment above) → action events =
       * execution_started+1 = 2-4. Still comfortably under the
       * ceiling of 5.
       */
      const executionStartedDepth = context.causal
        ? context.causal.depth + 1
        : 0;
      context.stepEvents = {
        executionId,
        tenantId: workflow.tenant,
        actionCausal: {
          causation_id: executionStartedEventId,
          correlation_id:
            context.causal?.correlation_id ?? executionStartedEventId,
          depth: executionStartedDepth + 1,
        },
        state: { count: 0, truncated: false },
      };
    } catch (_) {
      /* best-effort: a telemetry gap must never block the workflow */
    }
  }

  let status = "FAILED";
  try {
    await executeActions(workflow.actions, context);
    status = "COMPLETED";
    return context;
  } finally {
    if (executionId) {
      try {
        await publisher.publishExecutionCompletedEvent({
          executionId,
          status,
          tenantId: workflow.tenant,
          workflowName: workflow.name,
          /**
           * Reads context.causal (not workflow.causal): an agentCall may
           * have rederived the chain onto its execution_completed event
           * (fix 3). Identical to the trigger causal when no agent ran.
           */
          ...(context.causal && {
            correlationId: context.causal.correlation_id,
            causationId: context.causal.causation_id,
            depth: context.causal.depth + 1,
          }),
        });
      } catch (_) {
        /* best-effort: don't mask the original outcome */
      }
    }
  }
}
