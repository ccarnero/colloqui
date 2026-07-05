/**
 * `@yoizen/platform-sdk/config-files` — the `configFiles` resource client.
 * See sdk/README.md "Resource clients" for the pattern this follows (from
 * the `workflows` reference implementation).
 */

export type {
  ConfigFilesCallOptions,
  ConfigFilesClient,
  ConfigFilesClientDeps,
} from "./client.js";
export { createConfigFilesClient } from "./client.js";
export type {
  AgentTemplate,
  AgentTemplateSubagent,
  ConfigFile,
  ConfigFileFormat,
  ConfigFileFormatInput,
  DeployConfigFilesInput,
  DeployConfigFilesResult,
  ListConfigFilesParams,
  RuntimeStatus,
  UpsertConfigFileInput,
} from "./types.js";
