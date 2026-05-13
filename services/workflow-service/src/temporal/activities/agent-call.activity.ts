import Redis from "ioredis";
import { connect, type JetStreamClient, type NatsConnection } from "nats";
import { ApplicationFailure } from "@temporalio/activity";
import {
  DistributedCircuitBreaker,
  YoizenClawExecutionClient,
  computeBreakerKey,
  type AgentChatRequest,
  type HttpExecutionResult,
  type IBreakerConfig,
  type ICircuitBreakerRedis,
} from "@yoizen/shared";
import {
  PinoLoggerService,
  createCircuitBreakerMetrics,
} from "@yoizen/observability";
import { workflowServiceConfig } from "../../config";

const AGENT_CALL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Redis tunables. `maxRetriesPerRequest: 3` lets ioredis ride out a
 * single failover blip (typical Sentinel/Cluster reconfig is < 1s)
 * without immediately failing the activity attempt; Temporal-level
 * activity retries handle anything longer. `connectTimeout` caps the
 * initial TCP connect so a wedged node fails the activity in seconds
 * rather than hanging until the activity's start-to-close timeout.
 */
const REDIS_MAX_RETRIES_PER_REQUEST = 3;
const REDIS_CONNECT_TIMEOUT_MS = 5_000;

let agentBreakerInstance: DistributedCircuitBreaker | null = null;
let redisInstance: Redis | null = null;
let ncInstance: NatsConnection | null = null;
let jsInstance: JetStreamClient | null = null;
let executionClient: YoizenClawExecutionClient | null = null;

const logger = new PinoLoggerService("workflow-agent-call");

if (!workflowServiceConfig.redisHostExplicit) {
  logger.warn(
    `REDIS_HOST is not set — defaulting to ${workflowServiceConfig.redisHost}:${workflowServiceConfig.redisPort}. ` +
      "Outside local development this almost always means the workflow-worker " +
      "deployment is missing REDIS_HOST/REDIS_PORT and every agentCall will " +
      "fail with MaxRetriesPerRequestError.",
  );
}

function getRedis(): Redis {
  if (redisInstance) return redisInstance;
  redisInstance = new Redis({
    host: workflowServiceConfig.redisHost,
    port: workflowServiceConfig.redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    enableReadyCheck: true,
  });
  return redisInstance;
}

async function getNatsConnection(): Promise<NatsConnection> {
  if (ncInstance && !ncInstance.isClosed()) return ncInstance;
  ncInstance = await connect({
    servers: workflowServiceConfig.natsUrl,
    name: "workflow-service",
  });
  return ncInstance;
}

async function getJetStream(): Promise<JetStreamClient> {
  if (jsInstance) return jsInstance;
  const nc = await getNatsConnection();
  jsInstance = nc.jetstream();
  return jsInstance;
}

async function getExecutionClient(): Promise<YoizenClawExecutionClient> {
  if (executionClient) return executionClient;
  executionClient = new YoizenClawExecutionClient({
    nc: await getNatsConnection(),
    js: await getJetStream(),
    cache: getRedis(),
    serviceName: "workflow-service",
  });
  return executionClient;
}

function adaptIoredis(redis: Redis): ICircuitBreakerRedis {
  return {
    scriptLoad: (source: string) =>
      redis.script("LOAD", source) as Promise<string>,
    evalsha: (sha: string, numKeys: number, ...args: Array<string | number>) =>
      redis.evalsha(sha, numKeys, ...args) as Promise<unknown>,
    eval: (script: string, numKeys: number, ...args: Array<string | number>) =>
      redis.eval(script, numKeys, ...args) as Promise<unknown>,
  };
}

const AGENT_BREAKER_CONFIG: IBreakerConfig = {
  failureThreshold: 10,
  windowMs: 120_000,
  cooldownMs: 60_000,
  successThreshold: 3,
  probeTimeoutMs: 300_000,
  l1CacheMs: 500,
  fallbackOnRedisError: "allow",
  keyPrefix: "cb:workflow:agent",
};

function getAgentBreaker(): DistributedCircuitBreaker {
  if (agentBreakerInstance) return agentBreakerInstance;
  agentBreakerInstance = new DistributedCircuitBreaker(
    adaptIoredis(getRedis()),
    AGENT_BREAKER_CONFIG,
    logger,
    createCircuitBreakerMetrics("workflow-service"),
  );
  void agentBreakerInstance.scriptLoad().catch((err) =>
    logger.warn(`agent breaker scriptLoad failed (will retry on use): ${String(err)}`),
  );
  return agentBreakerInstance;
}

/**
 * Detects ioredis "I cannot reach the server" failures.
 *
 * `MaxRetriesPerRequestError` is the canonical wrapper after
 * `maxRetriesPerRequest` is exhausted, but the underlying cause
 * (ECONNREFUSED, ETIMEDOUT, getaddrinfo ENOTFOUND) sometimes surfaces
 * directly when a command is issued before the first connection
 * attempt completes. We match either shape so the operator always
 * sees the structured `REDIS_UNAVAILABLE` failure below instead of an
 * opaque ioredis stack trace.
 */
function isRedisUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "MaxRetriesPerRequestError") return true;
  const msg = err.message ?? "";
  return (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("max retries per request")
  );
}

export async function executeAgentCall(
  args: AgentChatRequest,
  tenantId: string,
): Promise<HttpExecutionResult> {
  const breaker = getAgentBreaker();
  const key = computeBreakerKey({ tenantId, agentId: args.agentId });

  const decision = await breaker.canProceed(key);
  if (decision.action === "deny") {
    throw ApplicationFailure.nonRetryable(
      `Circuit breaker ${decision.status} for agent '${args.agentId}' (${decision.reason})`,
      "CIRCUIT_OPEN",
      { key, status: decision.status, reason: decision.reason },
    );
  }

  try {
    const result = await executeAgentCallInner(args, tenantId);
    breaker.recordSuccess(key);
    return result;
  } catch (err) {
    breaker.recordFailure(key);
    if (isRedisUnavailableError(err)) {
      // Non-retryable: Temporal already retried 3× before — a config
      // error (missing REDIS_HOST/REDIS_PORT or wrong host) won't fix
      // itself between attempts. Failing fast surfaces the real cause
      // to the operator instead of burning the activity retry budget.
      throw ApplicationFailure.nonRetryable(
        `Redis at ${workflowServiceConfig.redisHost}:${workflowServiceConfig.redisPort}` +
          " is unreachable from workflow-worker. Verify REDIS_HOST/REDIS_PORT" +
          " env vars on the workflow-worker deployment and that the Redis" +
          ` service is healthy. Original: ${(err as Error).message}`,
        "REDIS_UNAVAILABLE",
        {
          host: workflowServiceConfig.redisHost,
          port: workflowServiceConfig.redisPort,
          original: (err as Error).message,
          redisHostExplicit: workflowServiceConfig.redisHostExplicit,
        },
      );
    }
    throw err;
  }
}

async function executeAgentCallInner(
  args: AgentChatRequest,
  tenantId: string,
): Promise<HttpExecutionResult> {
  const client = await getExecutionClient();
  const status = await client.executeAndWait(tenantId, args, AGENT_CALL_TIMEOUT_MS, {
    requestedBy: args.userId,
    correlationId: args.conversationId,
  });

  if (status.state === "failed") {
    throw new Error(
      status.result?.errorMessage ?? `YoizenClaw execution '${status.executionId}' failed`,
    );
  }

  return {
    status: 200,
    data: {
      reply: status.result?.reply ?? "",
      tool_calls: status.result?.tool_calls ?? [],
    },
    headers: {
      "x-yoizen-execution-id": status.executionId,
    },
  };
}
