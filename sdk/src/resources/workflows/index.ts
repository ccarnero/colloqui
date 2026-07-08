/**
 * `@yoizen/platform-sdk/workflows` — the `workflows` resource client. See
 * sdk/README.md "Resource clients" for the pattern every later resource
 * (agents, channels, connectors, ...) follows.
 */

export type {
  WorkflowCallOptions,
  WorkflowsClient,
  WorkflowsClientDeps,
} from "./client.js";
export { createWorkflowsClient } from "./client.js";
export type {
  CreateWorkflowInput,
  ExecuteWorkflowInput,
  ExecuteWorkflowOptions,
  ExecuteWorkflowResult,
  ExecutionStatusResult,
  ListExecutionsParams,
  McpCallAction,
  McpCallArgs,
  UpdateWorkflowInput,
  Workflow,
  WorkflowAction,
  WorkflowExecutionListItem,
  WorkflowExecutionsPage,
  WorkflowFailureInfo,
  WorkflowsSummary,
  WorkflowsSummaryTopDefinition,
  WorkflowTrigger,
} from "./types.js";
