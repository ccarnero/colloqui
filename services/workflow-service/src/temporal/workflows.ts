import { proxyActivities, workflowInfo } from "@temporalio/workflow";
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
  context: ExtendedContext
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const result = await executeAction(actions[i], context);
    context.results[actions[i].name] = result;
    context.variables.previous = (result ?? {}) as Record<string, unknown>;
    context.variables.node[actions[i].name] = (result ?? {}) as Record<
      string,
      unknown
    >;
  }
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
};

async function executeAction(
  action: WorkflowAction,
  context: ExtendedContext
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
        branchEntries.map(async ([_name, branchActions]) => {
          const branchCtx: WorkflowExecutionContext = {
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
          };
          await executeActions(branchActions, branchCtx);
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

      for (let i = 0; i < condAction.branches.length; i++) {
        const branch: IConditionalBranch = condAction.branches[i];
        const leftValue = resolvePathRaw(context, branch.condition.variable);
        const rightValue = resolveTemplates(branch.condition.value, context);

        if (
          evaluateCondition(leftValue, branch.condition.comparator, rightValue)
        ) {
          await executeActions(branch.actions, context);
          return { matchedBranch: branch.label };
        }
      }

      if (condAction.default && condAction.default.length > 0) {
        await executeActions(condAction.default, context);
        return { matchedBranch: "default" };
      }

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
  const context: WorkflowExecutionContext & {
    workflow: {
      name: string;
      tenant: string;
      application: string;
      agentTimeoutMs?: number;
    };
  } = {
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
      await publisher.publishExecutionStartedEvent({
        executionId,
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
