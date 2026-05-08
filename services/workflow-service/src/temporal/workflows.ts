import { proxyActivities } from "@temporalio/workflow";
import type {
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowAction,
  EventCausalContext,
  HttpEndpointRequest,
  HttpExecutionResult,
  HttpServiceRequest,
  AgentChatRequest,
  JsFunctionArgs,
  ServiceBusCallArgs,
  ChannelSendArgs,
} from "./workflow.types";
import {
  HTTP_ADAPTER_TASK_QUEUE,
  WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
} from "./workflow-queue";

interface IOrchestratorActivities {
  executeJsFunction(
    args: JsFunctionArgs,
    context: WorkflowExecutionContext,
  ): Promise<unknown>;
  executeServiceBusCall(
    args: ServiceBusCallArgs,
    tenantId: string,
  ): Promise<{ published: true; subject: string }>;
  executeChannelSend(
    args: ChannelSendArgs,
    tenantId: string,
    causal?: EventCausalContext,
  ): Promise<{ published: true; subject: string }>;
}

interface IExecutionPublisherActivities {
  publishExecutionCompletedEvent(
    executionId: string,
    status: string,
    tenantId?: string,
    workflowName?: string,
  ): Promise<void>;
}

interface IHttpActivities {
  executeEndpointCall(
    args: HttpEndpointRequest,
    tenantId: string,
  ): Promise<HttpExecutionResult>;
  executeServiceCall(
    args: HttpServiceRequest,
    tenantId: string,
  ): Promise<HttpExecutionResult>;
}

/** YoizenClaw chat can exceed default HTTP activity timeouts. */
interface IAgentHttpActivities {
  executeAgentCall(
    args: AgentChatRequest,
    tenantId: string,
  ): Promise<HttpExecutionResult>;
}

const local = proxyActivities<IOrchestratorActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
});

const publisher = proxyActivities<IExecutionPublisherActivities>({
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 2 },
});

const http = proxyActivities<IHttpActivities>({
  taskQueue: HTTP_ADAPTER_TASK_QUEUE,
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
});

const httpAgent = proxyActivities<IAgentHttpActivities>({
  taskQueue: WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;

function resolvePath(context: WorkflowExecutionContext, path: string): unknown {
  const segments = path.trim().split(".");
  let current: unknown = context;
  for (let i = 0; i < segments.length; i++) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[segments[i]];
  }
  return current ?? "";
}

function resolveTemplates<T>(value: T, context: WorkflowExecutionContext): T {
  if (typeof value === "string") {
    return value.replace(TEMPLATE_RE, (_, path: string) =>
      String(resolvePath(context, path)),
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
  context: WorkflowExecutionContext,
): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    context.results[actions[i].name] = await executeAction(actions[i], context);
  }
}

async function executeAction(
  action: WorkflowAction,
  context: WorkflowExecutionContext,
): Promise<unknown> {
  const tenant = context.workflow.tenant;

  switch (action.activity) {
    case "endpointCall":
      return http.executeEndpointCall(
        resolveTemplates(action.args, context),
        tenant,
      );

    case "jsFunction":
      return local.executeJsFunction(
        resolveTemplates(action.args, context),
        context,
      );

    case "serviceBusCall":
      return local.executeServiceBusCall(
        resolveTemplates(action.args, context),
        tenant,
      );

    case "channelSend":
      return local.executeChannelSend(
        resolveTemplates(action.args, context),
        tenant,
        context.causal,
      );

    case "serviceCall":
      return http.executeServiceCall(
        resolveTemplates(action.args, context),
        tenant,
      );

    case "agentCall":
      return httpAgent.executeAgentCall(
        resolveTemplates(action.args, context),
        tenant,
      );

    case "branch": {
      const branchEntries: Array<[string, WorkflowAction[]]> = [];
      const keys = Object.keys(action);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "activity" || key === "name") continue;
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
            ...(context.causal && { causal: context.causal }),
          };
          await executeActions(branchActions, branchCtx);
          return branchCtx.results;
        }),
      );

      for (let i = 0; i < branchResults.length; i++) {
        Object.assign(context.results, branchResults[i]);
      }
      return branchEntries.map(([name]) => name);
    }

    default: {
      const activity = (action as WorkflowAction).activity;
      throw new Error(
        `Unsupported workflow activity: ${String(activity)}`,
      );
    }
  }
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
  executionId?: string,
): Promise<WorkflowExecutionContext> {
  const context: WorkflowExecutionContext = {
    workflow: {
      name: workflow.name,
      tenant: workflow.tenant,
      application: workflow.application,
    },
    request: workflow.request,
    results: {},
    ...(workflow.causal && { causal: workflow.causal }),
  };

  let status = "FAILED";
  try {
    await executeActions(workflow.actions, context);
    status = "COMPLETED";
    return context;
  } finally {
    if (executionId) {
      try {
        await publisher.publishExecutionCompletedEvent(
          executionId,
          status,
          workflow.tenant,
          workflow.name,
        );
      } catch (_) {
        /* best-effort: don't mask the original outcome */
      }
    }
  }
}
