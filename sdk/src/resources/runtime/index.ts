/**
 * `@yoizen/platform-sdk/runtime` — the `runtime` resource client
 * (`runtime/executions`). See sdk/README.md "Resource clients" for the
 * pattern this follows (from the `workflows` reference implementation).
 * Includes `stream()` for runtime token streaming — see `./types.ts` for
 * the verified wire shapes and the `streaming_unsupported` degradation
 * semantics.
 */

export type {
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeClientDeps,
} from "./client.js";
export { createRuntimeClient } from "./client.js";
export type {
  CreateExecutionInput,
  CreateExecutionResult,
  ExecutionContextEntry,
  ExecutionResultPayload,
  ExecutionStatus,
  RuntimeHealth,
  RuntimeStreamEvent,
  RuntimeStreamFailedPayload,
  RuntimeStreamOptions,
  RuntimeTokenEventPayload,
  RuntimeToolCallEventPayload,
  RuntimeToolResultEventPayload,
} from "./types.js";
