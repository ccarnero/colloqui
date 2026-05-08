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

let agentBreakerInstance: DistributedCircuitBreaker | null = null;
let redisInstance: Redis | null = null;
let ncInstance: NatsConnection | null = null;
let jsInstance: JetStreamClient | null = null;
let executionClient: YoizenClawExecutionClient | null = null;

const logger = new PinoLoggerService("workflow-agent-call");

function getRedis(): Redis {
  if (redisInstance) return redisInstance;
  redisInstance = new Redis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number.parseInt(process.env.REDIS_PORT ?? "6379", 10),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
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
