import {
  platformServiceUrl,
  RATE_LIMIT_DEFAULT_LIMIT,
  RATE_LIMIT_DEFAULT_WINDOW_MS,
} from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

/**
 * JetStream `ack_wait` for the async invoke consumer
 * (`src/invoke-consumer-main.ts`). Exported (rather than inlined in that
 * entrypoint's consumer config) because it is one half of a cross-service
 * invariant: the worst-case handler chain
 * `ADAPTER_MAX_RETRIES_MAX * (ADAPTER_TIMEOUT_MS_MAX +
 * ADAPTER_RETRY_BACKOFF_MS_MAX)` (caps owned by `@yoizen/shared`) plus
 * `invokeWebhookTimeoutMs` MUST stay strictly below this value — otherwise
 * NATS redelivers an in-flight message and the outbound HTTP call is
 * duplicated. `test/unit/invoke-ack-wait-invariant.spec.ts` asserts that
 * against THIS constant, so raising a cap or lowering this number without
 * rebalancing breaks the build. Not env-overridable on purpose: an operator
 * tuning it by env would silently bypass that guard.
 */
export const INVOKE_CONSUMER_ACK_WAIT_MS = 300_000;

type WorkflowHttpWorkerConfig = {
  readonly port: number;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly redisHost: string;
  readonly redisPort: number;
  /**
   * When true, the breaker connects to Redis via the cluster client
   * (sharded topology, slot-aware routing). When false / unset, it
   * uses a standalone single-node connection. Wired via env so the
   * same image works against either deployment shape.
   */
  readonly redisClusterMode: boolean;
  readonly httpResponseCacheEnabled: boolean;
  readonly adapterServiceUrl: string;
  readonly registryServiceUrl: string;
  readonly agentAdminServiceUrl: string;
  readonly natsUrl: string;
  /**
   * Port for the HTTP invoke facade (`src/http-main.ts`,
   * `manual-loops/connector-invoke-api.md` T02) — a SECOND entrypoint of the
   * same deployable, distinct from the Temporal worker's health port
   * (`PORT`). Defaults to a different port so both can run in the same
   * process/container during local dev without clashing.
   */
  readonly httpFacadePort: number;
  /**
   * Per-tenant sliding-window rate limit for the invoke facade
   * (`checkRateLimit`, T02). Defaults reuse the platform-wide defaults
   * already established in `@yoizen/shared/rate-limit.constants.ts`
   * (`RATE_LIMIT_DEFAULT_LIMIT` / `_WINDOW_MS`) — this queue's SPEC.md
   * flags "rate-limit defaults" as a human boundary, so this task does NOT
   * invent new numbers, it reuses the already-approved platform defaults
   * with env overrides for operators to tune per deployment.
   */
  readonly rateLimitPerTenant: {
    readonly limit: number;
    readonly windowMs: number;
  };
  /**
   * TTL (seconds) for the Redis-parked async invocation result
   * (`invocation:<tenant>:<id>`, T05). SPEC.md human boundary: "Redis
   * result TTL: config-driven, default 15m" — 15 minutes is the SPEC's
   * stated default; kept overridable via env for operators.
   */
  readonly invocationResultTtlSeconds: number;
  /** Per-request timeout (ms) for the T05 outbound webhook delivery POST. */
  readonly invokeWebhookTimeoutMs: number;
  /**
   * Health-check port for the T05 async invoke consumer
   * (`src/invoke-consumer-main.ts`) — a THIRD entrypoint of this
   * deployable, distinct from the Temporal worker's `PORT` and the HTTP
   * facade's `httpFacadePort`.
   */
  readonly invokeConsumerHealthPort: number;
};

export const workflowHttpWorkerConfig: WorkflowHttpWorkerConfig = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
  redisClusterMode: process.env.REDIS_CLUSTER_MODE === "true",
  httpResponseCacheEnabled:
    process.env.HTTP_RESPONSE_CACHE_ENABLED?.toLowerCase() !== "false",
  adapterServiceUrl:
    process.env.CONNECTOR_ADMIN_URL ??
    platformServiceUrl("connector-admin-api", env),
  registryServiceUrl:
    process.env.REGISTRY_SERVICE_URL ??
    platformServiceUrl("registry-service", env),
  agentAdminServiceUrl:
    process.env.AGENT_ADMIN_SERVICE_URL ??
    platformServiceUrl("agent-admin-service", env),
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  httpFacadePort: Number.parseInt(process.env.HTTP_FACADE_PORT ?? "3100", 10),
  rateLimitPerTenant: {
    limit: Number.parseInt(
      process.env.INVOKE_RATE_LIMIT ?? String(RATE_LIMIT_DEFAULT_LIMIT),
      10
    ),
    windowMs: Number.parseInt(
      process.env.INVOKE_RATE_LIMIT_WINDOW_MS ??
        String(RATE_LIMIT_DEFAULT_WINDOW_MS),
      10
    ),
  },
  invocationResultTtlSeconds: Number.parseInt(
    process.env.INVOCATION_RESULT_TTL_SECONDS ?? String(15 * 60),
    10
  ),
  invokeWebhookTimeoutMs: Number.parseInt(
    process.env.INVOKE_WEBHOOK_TIMEOUT_MS ?? "10000",
    10
  ),
  invokeConsumerHealthPort: Number.parseInt(
    process.env.INVOKE_CONSUMER_HEALTH_PORT ?? "3200",
    10
  ),
};
