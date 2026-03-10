import { proxyActivities } from '@temporalio/workflow';
import type {
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowAction,
  EndpointCallArgs,
  JsFunctionArgs,
  ServiceBusCallArgs,
} from '@yoizen/shared';

interface OrchestratorActivities {
  executeJsFunction(
    args: JsFunctionArgs,
    context: WorkflowExecutionContext,
  ): Promise<unknown>;
  executeServiceBusCall(
    args: ServiceBusCallArgs,
    tenantId: string,
  ): Promise<{ published: true; subject: string }>;
}

interface HttpActivities {
  executeEndpointCall(
    args: EndpointCallArgs,
    tenantId: string,
  ): Promise<{ status: number; data: unknown; headers: Record<string, string> }>;
}

const local = proxyActivities<OrchestratorActivities>({
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 3 },
});

const http = proxyActivities<HttpActivities>({
  taskQueue: 'workflow-http',
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 3 },
});

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;

function resolvePath(context: WorkflowExecutionContext, path: string): unknown {
  const segments = path.trim().split('.');
  let current: unknown = context;
  for (let i = 0; i < segments.length; i++) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[segments[i]];
  }
  return current ?? '';
}

function resolveTemplates<T>(value: T, context: WorkflowExecutionContext): T {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_RE, (_, path: string) =>
      String(resolvePath(context, path)),
    ) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplates(v, context)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
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
    case 'endpointCall':
      return http.executeEndpointCall(
        resolveTemplates(action.args, context),
        tenant,
      );

    case 'jsFunction':
      return local.executeJsFunction(
        resolveTemplates(action.args, context),
        context,
      );

    case 'serviceBusCall':
      return local.executeServiceBusCall(
        resolveTemplates(action.args, context),
        tenant,
      );

    case 'branch': {
      const branchEntries: Array<[string, WorkflowAction[]]> = [];
      const keys = Object.keys(action);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === 'activity' || key === 'name') continue;
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
  }
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
): Promise<WorkflowExecutionContext> {
  const context: WorkflowExecutionContext = {
    workflow: {
      name: workflow.name,
      tenant: workflow.tenant,
      application: workflow.application,
    },
    request: workflow.request,
    results: {},
  };
  await executeActions(workflow.actions, context);
  return context;
}
