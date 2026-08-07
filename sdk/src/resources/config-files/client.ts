import type { Paginated } from "../../core/pagination.js";
import { paginate, toOffsetPage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  AgentTemplate,
  ConfigFile,
  DeployConfigFilesInput,
  DeployConfigFilesResult,
  ListConfigFilesParams,
  RuntimeStatus,
  UpsertConfigFileInput,
} from "./types.js";

export interface ConfigFilesClientDeps {
  transport: Transport;
}

export interface ConfigFilesCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface ConfigFilesClient {
  /** `GET /admin/config-files` — real `limit`/`offset` + `{files,total}` pagination. */
  list(params?: ListConfigFilesParams): Paginated<ConfigFile>;
  /** `GET /admin/config-files/file?path=...`. 404s if the path doesn't exist. */
  getByPath(path: string, opts?: ConfigFilesCallOptions): Promise<ConfigFile>;
  /**
   * `PUT /admin/config-files` — create-or-update a single config file keyed
   * by `path`. The fixed `{name,path,content,format}` shape is live on the
   * dev cluster and covered by `test/e2e/admin-final.e2e.ts` — see
   * `types.ts`.
   */
  upsert(
    input: UpsertConfigFileInput,
    opts?: ConfigFilesCallOptions
  ): Promise<ConfigFile>;
  /**
   * `POST /admin/config-files/deploy` — `deletePaths` removes files from
   * the runtime config set as part of the deploy. Live on the dev cluster
   * and covered by `test/e2e/admin-final.e2e.ts` — see `types.ts`.
   */
  deploy(
    input?: DeployConfigFilesInput,
    opts?: ConfigFilesCallOptions
  ): Promise<DeployConfigFilesResult>;
  /** `GET /admin/runtime/status`. */
  runtimeStatus(opts?: ConfigFilesCallOptions): Promise<RuntimeStatus>;
  /** `GET /admin/templates` — unwraps the `{templates}` envelope into a bare array. */
  templates(opts?: ConfigFilesCallOptions): Promise<AgentTemplate[]>;
}

/**
 * Creates the `configFiles` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createConfigFilesClient({
  transport,
}: ConfigFilesClientDeps): ConfigFilesClient {
  function toQuery(
    params: Record<string, string | number | undefined>
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return qs.length > 0 ? `?${qs}` : "";
  }

  function list(params: ListConfigFilesParams = {}): Paginated<ConfigFile> {
    return paginate<ConfigFile>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        files: ConfigFile[];
        total: number;
      }>({
        path: `/admin/config-files${toQuery({
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toOffsetPage(body.files, body.total, params.offset ?? offset);
    });
  }

  async function getByPath(
    path: string,
    opts: ConfigFilesCallOptions = {}
  ): Promise<ConfigFile> {
    const { body } = await transport.request<ConfigFile>({
      path: `/admin/config-files/file${toQuery({ path })}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function upsert(
    input: UpsertConfigFileInput,
    opts: ConfigFilesCallOptions = {}
  ): Promise<ConfigFile> {
    const { body } = await transport.request<ConfigFile>({
      path: "/admin/config-files",
      method: "PUT",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function deploy(
    input: DeployConfigFilesInput = {},
    opts: ConfigFilesCallOptions = {}
  ): Promise<DeployConfigFilesResult> {
    const { body } = await transport.request<DeployConfigFilesResult>({
      path: "/admin/config-files/deploy",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function runtimeStatus(
    opts: ConfigFilesCallOptions = {}
  ): Promise<RuntimeStatus> {
    const { body } = await transport.request<RuntimeStatus>({
      path: "/admin/runtime/status",
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function templates(
    opts: ConfigFilesCallOptions = {}
  ): Promise<AgentTemplate[]> {
    const { body } = await transport.request<{ templates: AgentTemplate[] }>({
      path: "/admin/templates",
      method: "GET",
      retry: opts.retry,
    });
    return body.templates;
  }

  return { list, getByPath, upsert, deploy, runtimeStatus, templates };
}
