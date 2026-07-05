/**
 * Request/response types for the `configFiles` resource, hand-typed against
 * the REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/admin/admin-config.controller.ts` (+
 *   `admin.dto.ts`) — `@Controller("admin")`, literal route paths, proxies
 *   via `AdminProxyService` to `agent-admin-service`.
 * - `services/agent-admin-service/src/modules/config-files/
 *   {config-files.controller.ts, config-files.dto.ts,
 *   config-files.repository.interface.ts}` (`IConfigFile`) and
 *   `.../runtime/runtime.service.ts` (`IRuntimeStatus`) and
 *   `.../templates/templates.service.ts` (`IAgentTemplate`).
 *
 * `PUT /admin/config-files` — the gateway's `UpsertConfigFileDto` was fixed
 * to match the downstream `ConfigFilesController.createOrUpdate()` contract:
 * a SINGLE file object `{ name, path, content, format }` (previously the
 * gateway whitelisted `{ files: [{ path, content }] }`, an array with no
 * `name`/`format`, which could never satisfy both the gateway's
 * `forbidNonWhitelisted: true` validation AND the downstream's required
 * `name`/`format` fields at once — every call 400'd one side or the other).
 * `upsert()` is typed here against the FIXED gateway DTO. As of 2026-07-05
 * this fix exists in gateway source but the dev cluster's running pod still
 * rejects the fixed shape (400 "property name/path/content/format should
 * not exist") — the fix is not yet hot-reloaded/deployed. Verified live
 * 2026-07-05.
 *
 * `POST /admin/config-files/deploy` — the gateway's `DeployConfigFilesDto`
 * was fixed to match the downstream shape: only `deletePaths?: string[]`
 * (previously it whitelisted `file_paths?`/`is_active?`/
 * `knowledge_base_ids?`/`input_variables?`/`output_variables?`, none of
 * which the downstream `deploy()` handler reads, while `deletePaths` — the
 * only field downstream actually uses — was stripped before reaching the
 * proxy). `deploy()` now accepts `deletePaths` and forwards it as-is. This
 * fix is also pending deploy to the dev cluster as of 2026-07-05 (not
 * independently probed live; assumed pending given `upsert()`'s confirmed
 * not-live status on the same controller/pod).
 */

export type ConfigFileFormatInput = "yaml" | "json";

/**
 * `PUT /admin/config-files` body — matches the FIXED gateway
 * `UpsertConfigFileDto` (single file, create-or-update keyed by `path`).
 * See `types.ts` header for live-deploy status.
 */
export interface UpsertConfigFileInput {
  /** Max length enforced gateway-side. */
  name: string;
  path: string;
  /** Max 1,000,000 characters. */
  content: string;
  format: ConfigFileFormatInput;
}

/**
 * `POST /admin/config-files/deploy` body — matches the FIXED gateway
 * `DeployConfigFilesDto` (mirrors the downstream shape exactly: only
 * `deletePaths`). See `types.ts` header for live-deploy status.
 */
export interface DeployConfigFilesInput {
  /** Paths to remove from the runtime config set as part of this deploy. */
  deletePaths?: string[];
}

export interface ListConfigFilesParams {
  limit?: number;
  offset?: number;
}

export type ConfigFileFormat = "yaml" | "json";

export interface ConfigFile {
  id: string;
  name: string;
  path: string;
  content: string;
  format: ConfigFileFormat;
  version: number;
  is_active: boolean;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

export interface DeployConfigFilesResult {
  files: ConfigFile[];
  eventEmitted: boolean;
}

export interface RuntimeStatus {
  configured: boolean;
  connected_runtimes: string[];
  /** ISO-8601 timestamp, when set. */
  last_sync_at?: string;
}

export interface AgentTemplateSubagent {
  name: string;
  description: string;
  system_prompt: string;
  enabled: boolean;
}

export interface AgentTemplate {
  id: string;
  label: string;
  name: string;
  description: string;
  system_prompt: string;
  rules: string;
  soul: string;
  subagents: AgentTemplateSubagent[];
}
