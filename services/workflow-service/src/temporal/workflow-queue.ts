/**
 * Orchestrator workflow bundle must not import `@yoizen/shared` (barrel or DTOs):
 * Temporal's V8 isolate has no `reflect-metadata`, and package imports can pull in
 * class-validator metadata. Keep this literal aligned with
 * `WORKFLOW_ORCHESTRATOR_TASK_QUEUE` and
 * `CONNECTOR_RUNTIME_TASK_QUEUE` in `packages/shared/src/constants.ts`.
 */
export const WORKFLOW_ORCHESTRATOR_TASK_QUEUE = "workflow-orchestrator";
export const CONNECTOR_RUNTIME_TASK_QUEUE = "connector-runtime";
