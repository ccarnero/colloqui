/**
 * `@yoizen/platform-sdk/runtime` — the `runtime` resource client
 * (`runtime/executions`). See sdk/README.md "Resource clients" for the
 * pattern this follows (from the `workflows` reference implementation).
 * No `stream()` method — see `./types.ts` for the verified streaming gap.
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
} from "./types.js";
