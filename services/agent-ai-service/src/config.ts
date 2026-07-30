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
  readonly testDelayEnabled: boolean;
  readonly testDelayMaxMs: number;
};

/**
 * Absolute ceiling (ms) for the dev-only deterministic execution delay hook
 * (`test-delay.ts`). Deliberately below BOTH the consumer ackWait
 * (`consumerAckWaitMs`, 900_000 — the JetStream message is held for the whole
 * handler, `nats-consumer-runner.ts`) and the buffered-execution abort ceiling
 * (`bufferedExecutionTimeoutMs`, 900_000), so an injected delay can never push
 * an execution past redelivery or silently swallow the abort timer. Not
 * overridable upward: `AGENT_TEST_DELAY_MAX_MS` can only lower it.
 */
export const AGENT_TEST_DELAY_HARD_CAP_MS = 600_000;

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
   * `"<serverName>__<toolName>"` (sanitized — agent-mcp-tool-naming.md T01,
   * Option B; was `"<serverName>:<toolName>"` before T01, which violated
   * OpenAI's tool-name pattern), filtered by the agent's `enabled_mcp_tools`,
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
  /**
   * Gates the deterministic execution delay hook in `handleBuffered`
   * (`execution.handler.ts`, long-running-agent-executions.md T02). When
   * `false` (the default, and the only value in any non-dev overlay), the
   * `__test_delay_ms` key carried by an execution's variables/metadata is
   * ignored and logged at debug — production behavior is byte-identical to
   * before the hook existed. Only the local dev overlays set
   * `AGENT_TEST_DELAY_ENABLED=true`.
   */
  get testDelayEnabled() {
    return process.env.AGENT_TEST_DELAY_ENABLED === "true";
  },
  /**
   * Upper bound (ms) applied to the per-execution `__test_delay_ms` value.
   * Defaults to {@link AGENT_TEST_DELAY_HARD_CAP_MS} and is hard-clamped to
   * it, so `AGENT_TEST_DELAY_MAX_MS` can only ever LOWER the ceiling (tests
   * use a few ms). Non-numeric / non-positive overrides fall back to the
   * hard cap.
   */
  get testDelayMaxMs() {
    const raw = process.env.AGENT_TEST_DELAY_MAX_MS;
    if (raw === undefined) {
      return AGENT_TEST_DELAY_HARD_CAP_MS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return AGENT_TEST_DELAY_HARD_CAP_MS;
    }
    return Math.min(parsed, AGENT_TEST_DELAY_HARD_CAP_MS);
  },
};
