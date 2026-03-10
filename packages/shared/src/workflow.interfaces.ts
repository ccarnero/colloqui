export interface WorkflowExecutionContext {
  workflow: { name: string; tenant: string; application: string };
  request: Record<string, any>;
  results: Record<string, any>;
}

export interface EndpointCallArgs {
  method: string;
  url: string;
  params?: Record<string, any>;
  data?: any;
  headers?: Record<string, string>;
}

export interface JsFunctionArgs {
  code: string;
}

export interface ServiceBusCallArgs {
  subject: string;
  payload?: any;
  headers?: Record<string, string>;
}

export interface EndpointCallAction {
  activity: 'endpointCall';
  name: string;
  args: EndpointCallArgs;
}

export interface JsFunctionAction {
  activity: 'jsFunction';
  name: string;
  args: JsFunctionArgs;
}

export interface ServiceBusCallAction {
  activity: 'serviceBusCall';
  name: string;
  args: ServiceBusCallArgs;
}

export interface BranchAction {
  activity: 'branch';
  name: string;
  [branchName: string]: WorkflowAction[] | string;
}

export type WorkflowAction =
  | EndpointCallAction
  | JsFunctionAction
  | ServiceBusCallAction
  | BranchAction;

export interface WorkflowDefinition {
  name: string;
  tenant: string;
  application: string;
  request: Record<string, any>;
  actions: WorkflowAction[];
}
