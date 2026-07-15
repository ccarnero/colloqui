import { createIngestClient } from "../application/ingest-client.js";
import type { Session } from "../core/session.js";
import { createSession } from "../core/session.js";
import { createTransport } from "../core/transport.js";
import { ConfigError } from "../domain/errors.js";
import type { AgentsClient } from "../resources/agents/index.js";
import { createAgentsClient } from "../resources/agents/index.js";
import type { AuditClient } from "../resources/audit/index.js";
import { createAuditClient } from "../resources/audit/index.js";
import type { AuthAdminClient } from "../resources/auth-admin/index.js";
import { createAuthAdminClient } from "../resources/auth-admin/index.js";
import type { ChannelsClient } from "../resources/channels/index.js";
import { createChannelsClient } from "../resources/channels/index.js";
import type { ConfigFilesClient } from "../resources/config-files/index.js";
import { createConfigFilesClient } from "../resources/config-files/index.js";
import type { ConnectorsClient } from "../resources/connectors/index.js";
import { createConnectorsClient } from "../resources/connectors/index.js";
import type { DashboardClient } from "../resources/dashboard/index.js";
import { createDashboardClient } from "../resources/dashboard/index.js";
import type { JobsClient } from "../resources/jobs/index.js";
import { createJobsClient } from "../resources/jobs/index.js";
import type { KnowledgeBasesClient } from "../resources/knowledge-bases/index.js";
import { createKnowledgeBasesClient } from "../resources/knowledge-bases/index.js";
import type { ManifestsClient } from "../resources/manifests/index.js";
import { createManifestsClient } from "../resources/manifests/index.js";
import type { McpServersClient } from "../resources/mcp-servers/index.js";
import { createMcpServersClient } from "../resources/mcp-servers/index.js";
import type { MemoriesClient } from "../resources/memories/index.js";
import { createMemoriesClient } from "../resources/memories/index.js";
import type { RegistryClient } from "../resources/registry/index.js";
import { createRegistryClient } from "../resources/registry/index.js";
import type { RuntimeClient } from "../resources/runtime/index.js";
import { createRuntimeClient } from "../resources/runtime/index.js";
import type { SecretsClient } from "../resources/secrets/index.js";
import { createSecretsClient } from "../resources/secrets/index.js";
import type { SkillsClient } from "../resources/skills/index.js";
import { createSkillsClient } from "../resources/skills/index.js";
import type { StructuredKbClient } from "../resources/structured-kb/index.js";
import { createStructuredKbClient } from "../resources/structured-kb/index.js";
import type { SystemVariablesClient } from "../resources/system-variables/index.js";
import { createSystemVariablesClient } from "../resources/system-variables/index.js";
import type { TenantsClient } from "../resources/tenants/index.js";
import { createTenantsClient } from "../resources/tenants/index.js";
import type { WebhooksClient } from "../resources/webhooks/index.js";
import { createWebhooksClient } from "../resources/webhooks/index.js";
import type { WorkflowsClient } from "../resources/workflows/index.js";
import { createWorkflowsClient } from "../resources/workflows/index.js";
import { createAuthAdapter } from "./auth-adapter.js";
import { createChannelDirectoryAdapter } from "./channel-directory-adapter.js";
import type { UserConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import type { FetchLike } from "./http.js";
import { createIngestAdapter } from "./ingest-adapter.js";
import { createSystemClock } from "./system-clock.js";

export interface Client {
  send: ReturnType<typeof createIngestClient>["send"];
  sendText: ReturnType<typeof createIngestClient>["sendText"];
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  workflows: WorkflowsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  agents: AgentsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  runtime: RuntimeClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  channels: ChannelsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  webhooks: WebhooksClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  knowledgeBases: KnowledgeBasesClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  skills: SkillsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  systemVariables: SystemVariablesClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  mcpServers: McpServersClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  connectors: ConnectorsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  registry: RegistryClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  authAdmin: AuthAdminClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  tenants: TenantsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  audit: AuditClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  jobs: JobsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  memories: MemoriesClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  structuredKb: StructuredKbClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  configFiles: ConfigFilesClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  dashboard: DashboardClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  manifests: ManifestsClient;
  /** Namespaced resource client — see sdk/README.md "Resource clients". */
  secrets: SecretsClient;
}

/**
 * Composition root. Resolves config, wires the shared transport and the real
 * HTTP adapters over it, and returns `{ send, sendText, workflows, ... }`.
 *
 * All adapters and resource clients share ONE transport instance. `send`/
 * `sendText` keep their pre-Phase-2 behavior unchanged: auth login/refresh
 * are unauthenticated (`auth: false`), channel-directory and ingest pass an
 * explicit token / skip auth entirely, and `createIngestClient` still owns
 * its own internal `Session` for that flow (src/application/ingest-client.ts)
 * — none of that was touched.
 *
 * Resource clients (workflows, and everything Phase 2 adds after it) DO need
 * session-bound `Authorization: Bearer` auth on the shared transport, which
 * Phase 1 deliberately left unbound (see src/core/transport.ts). Binding it
 * here creates a circular dependency — the transport needs a `Session` to
 * bind, the `Session` needs an `AuthPort` built over the transport — broken
 * with a thin forwarding wrapper (`sessionRef`) passed to `createTransport`
 * before the real `Session` exists, then pointed at it once it does. No
 * request executes before that assignment; both happen synchronously in this
 * function. `Boolean(session)` being true from construction just means
 * requests that don't explicitly pass `auth` now default to session-bound
 * auth — exactly what every ingest adapter already opts out of explicitly
 * (`auth: false`), so `send`/`sendText` stay byte-compatible.
 *
 * @param userConfig see README for fields. `fetch` and `clock` are injectable for tests.
 */
export function createClient(userConfig: UserConfig = {}): Client {
  const config = resolveConfig(userConfig);

  const fetchImpl = (userConfig.fetch ?? globalThis.fetch) as
    | FetchLike
    | undefined;
  if (typeof fetchImpl !== "function") {
    throw new ConfigError(
      "global fetch is unavailable; use Node >=18 or pass `fetch` in config"
    );
  }
  const clock = userConfig.clock ?? createSystemClock();
  const {
    baseUrl,
    timeoutMs,
    tenant,
    apiVersion,
    retry,
    email,
    password,
    tokenExpiryBufferMs,
    onWarn,
  } = config;

  let boundSession: Session | undefined;
  const sessionRef: Session = {
    ensureToken: () => boundSession!.ensureToken(),
    getToken: () => boundSession?.getToken() ?? null,
  };

  const transport = createTransport({
    fetchImpl,
    baseUrl,
    tenant,
    timeoutMs,
    apiVersion,
    retry,
    session: sessionRef,
  });

  const ports = {
    auth: createAuthAdapter({ transport, clock }),
    channelDirectory: createChannelDirectoryAdapter({ transport }),
    ingest: createIngestAdapter({ transport }),
  };

  boundSession = createSession({
    auth: ports.auth,
    clock,
    config: { tenant, email, password, tokenExpiryBufferMs, onWarn },
  });

  const { send, sendText } = createIngestClient({ ports, config, clock });
  const workflows = createWorkflowsClient({ transport });
  const agents = createAgentsClient({ transport });
  const runtime = createRuntimeClient({ transport });
  const channels = createChannelsClient({ transport });
  const webhooks = createWebhooksClient({ transport });
  const knowledgeBases = createKnowledgeBasesClient({ transport });
  const skills = createSkillsClient({ transport });
  const systemVariables = createSystemVariablesClient({ transport });
  const mcpServers = createMcpServersClient({ transport });
  const connectors = createConnectorsClient({ transport });
  const registry = createRegistryClient({ transport });
  const authAdmin = createAuthAdminClient({ transport });
  const tenants = createTenantsClient({ transport });
  const audit = createAuditClient({ transport });
  const jobs = createJobsClient({ transport });
  const memories = createMemoriesClient({ transport });
  const structuredKb = createStructuredKbClient({ transport });
  const configFiles = createConfigFilesClient({ transport });
  const dashboard = createDashboardClient({ transport });
  const manifests = createManifestsClient({ transport });
  const secrets = createSecretsClient({ transport });

  return {
    send,
    sendText,
    workflows,
    agents,
    runtime,
    channels,
    webhooks,
    knowledgeBases,
    skills,
    systemVariables,
    mcpServers,
    connectors,
    registry,
    authAdmin,
    tenants,
    audit,
    jobs,
    memories,
    structuredKb,
    configFiles,
    dashboard,
    manifests,
    secrets,
  };
}
