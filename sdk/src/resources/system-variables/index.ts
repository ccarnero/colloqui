/**
 * `@yoizen/platform-sdk/system-variables` — the `systemVariables` resource
 * client. See sdk/README.md "Resource clients" for the pattern this follows
 * (from the `workflows` reference implementation).
 */

export type {
  SystemVariableCallOptions,
  SystemVariablesClient,
  SystemVariablesClientDeps,
} from "./client.js";
export { createSystemVariablesClient } from "./client.js";
export type {
  CreateSystemVariableInput,
  ListSystemVariablesPage,
  ListSystemVariablesParams,
  SystemVariable,
  SystemVariableType,
  UpdateSystemVariableInput,
} from "./types.js";
