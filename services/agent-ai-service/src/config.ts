import { resolveStorageEngine, type StorageEngine } from "@yoizen/database";
import { platformServiceUrl } from "@yoizen/shared";

type AgentAiServiceConfig = {
  readonly port: number;
  readonly dbEngine: StorageEngine;
  readonly platformEnvironment: string;
  readonly natsUrl: string;
  readonly redisUrl: string;
  readonly memoryServiceUrl: string;
  readonly connectorAdminUrl: string;
  readonly agentAdminServiceUrl: string;
  readonly toolDescriptionOverridesEnabled: boolean;
  readonly mcpToolFilteringEnabled: boolean;
  readonly consumerAckWaitMs: number;
  readonly consumerWorkingIntervalMs: number;
  readonly mcpLiveCallTimeoutMs: number;
  readonly bufferedExecutionTimeoutMs: number;
};

export const agentAiServiceConfig: AgentAiServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  get dbEngine() {
    return resolveStorageEngine();
  },
  get platformEnvironment() {
    return process.env.PLATFORM_ENVIRONMENT ?? "dev";
  },
  get natsUrl() {
    return process.env.NATS_URL ?? "nats://localhost:4222";
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get memoryServiceUrl() {
    return process.env.MEMORY_SERVICE_URL ?? "http://agent-memory-service:3000";
  },
  get connectorAdminUrl() {
    return process.env.CONNECTOR_ADMIN_URL ?? "http://connector-admin-api:3000";
  },
  get agentAdminServiceUrl() {
    return (
      process.env.AGENT_ADMIN_SERVICE_URL ??
      platformServiceUrl("agent-admin-service", this.platformEnvironment)
    );
  },
  get toolDescriptionOverridesEnabled() {
    return process.env.AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED === "true";
  },
  /**
   * Gates the per-tool MCP filtering path in `tool-bridge.service.ts`'s
   * `mergeMcpTools` (mcp-connections.md §4). When `false` (default), MCP tools
   * merge with raw (non-namespaced) tool-name keys and no per-tool allowlist —
   * exactly the pre-Phase-4 behavior. When `true`, tools are namespaced as
   * `"<serverName>:<toolName>"`, filtered by the agent's `enabled_mcp_tools`,
   * and eligible for namespaced description overrides. Toggle via
   * `AGENT_MCP_TOOL_FILTERING_ENABLED=true` (no code revert needed to disable).
   */
  get mcpToolFilteringEnabled() {
    return process.env.AGENT_MCP_TOOL_FILTERING_ENABLED === "true";
  },
  /**
   * Ack-wait window (ms) for the multi-tenant NATS consumer
   * (`multi-tenant-consumer.service.ts`). Its handlers run `generateReply`
   * — LLM calls with tool/MCP chains that routinely take minutes — so this
   * must comfortably exceed worst-case handler runtime; otherwise the
   * server redelivers the unacked message mid-handler, causing duplicate
   * concurrent LLM executions. Default matches `AGENT_CALL_TIMEOUT_MS`
   * (Temporal's agent-call activity timeout) for consistency across the
   * platform. Override via `AGENT_AI_CONSUMER_ACK_WAIT_MS`.
   */
  get consumerAckWaitMs() {
    return Number.parseInt(
      process.env.AGENT_AI_CONSUMER_ACK_WAIT_MS ?? String(900_000),
      10
    );
  },
  /**
   * Interval (ms) at which the multi-tenant consumer calls `msg.working()`
   * while a handler is in flight, extending the server-side ack deadline
   * without waiting for the full `consumerAckWaitMs` window. Override via
   * `AGENT_AI_CONSUMER_WORKING_INTERVAL_MS`.
   */
  get consumerWorkingIntervalMs() {
    return Number.parseInt(
      process.env.AGENT_AI_CONSUMER_WORKING_INTERVAL_MS ?? String(30_000),
      10
    );
  },
  /**
   * Bounded wait for live-chat MCP client operations (connect, tool
   * discovery, tool execution). Mirrors `MCP_CALL_TIMEOUT_MS` in
   * `connector-runtime`'s `mcp-call.activity.ts`. Override via
   * `MCP_LIVE_CALL_TIMEOUT_MS`.
   */
  get mcpLiveCallTimeoutMs() {
    return Number.parseInt(
      process.env.MCP_LIVE_CALL_TIMEOUT_MS ?? String(25_000),
      10
    );
  },
  /**
   * Wall-clock ceiling (ms) for the buffered (non-streaming) NATS
   * execution path (`execution.handler.ts`'s `handleBuffered`). Bounds
   * compute even when no explicit cancel arrives. Default matches
   * `AGENT_CALL_TIMEOUT_MS`. Override via
   * `AGENT_BUFFERED_EXECUTION_TIMEOUT_MS`.
   */
  get bufferedExecutionTimeoutMs() {
    return Number.parseInt(
      process.env.AGENT_BUFFERED_EXECUTION_TIMEOUT_MS ?? String(900_000),
      10
    );
  },
};
