import { randomUUID } from "node:crypto";
import { createMCPClient } from "@ai-sdk/mcp";
import { ApplicationFailure } from "@temporalio/activity";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { EventCausalContext, McpCallArgs } from "@yoizen/shared";
import {
  computeBreakerKey,
  reportMcpUsageEvent,
  TENANT_HEADER,
} from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../config";
import { getHttpBreaker, HTTP_BREAKER_COOLDOWN_MS } from "./_shared/breaker";
import { publishMcpCallEvent } from "./_shared/event-publisher";
import { truncateBody } from "./_shared/truncate-body";

const logger = new PinoLoggerService("mcp-call.activity");

/** Bounded wait to resolve the MCP server config from agent-admin-service. */
const CONFIG_LOOKUP_TIMEOUT_MS = 10_000;
/** Bounded wait for the ephemeral connect + single tool call. */
const MCP_CALL_TIMEOUT_MS = 25_000;

type McpServerAuthType = "none" | "api-key" | "bearer" | "basic";

/**
 * Snake-cased MCP server row as returned by
 * `GET admin/mcp-servers/:id` (`agent-admin-service`'s `IMcpServer`,
 * mcp-connections.md §2.1). Only the fields this activity needs are typed.
 */
interface IMcpServerConfig {
  id: string;
  name: string;
  transport_type: "http" | "sse";
  url: string;
  headers: Record<string, string> | null;
  auth_type: McpServerAuthType;
  auth_config: Record<string, unknown> | null;
  /**
   * SSRF-relevant scope (mcp-connections.md SSRF-scope follow-up).
   * `"internal"` is an explicit admin opt-in — see `validateUrl` below.
   * Defaults to `"external"` when the admin-service response omits it (e.g.
   * an older row created before this field existed).
   */
  scope?: "external" | "internal";
}

/**
 * Minimal shape of the MCP `CallToolResult` this activity reads. The AI SDK
 * types it fully, but we only need `content`/`isError`, so we keep a local
 * loose shape to avoid importing SDK-internal types.
 */
interface ICallToolResult {
  content?: unknown;
  isError?: boolean;
}

/**
 * A single AI SDK tool from `client.tools()`, narrowed to just its `execute`.
 * `execute`'s second argument (AI SDK `ToolCallOptions`) is typed `unknown`
 * here on purpose: MCP tools ignore the LLM-oriented fields (`toolCallId`,
 * `messages`), and typing it loosely avoids a hard dependency on the SDK's
 * internal option type across a version bump.
 */
type McpExecutableTool = {
  execute: (input: unknown, options: unknown) => Promise<ICallToolResult>;
};

/** Normalized result of an `mcpCall` activity execution. */
export interface IMcpCallResult {
  toolName: string;
  /** The tool's `CallToolResult` payload (its `content`, verbatim). */
  result: unknown;
  /** `true` when the MCP server flagged the tool call as an error (`isError`). */
  isError: boolean;
  durationMs: number;
}

/**
 * Temporal activity: invokes a single tool on a registered MCP server
 * (mcp-connections.md §5.2). Same overall shape as
 * `endpoint-call.activity.ts`: resolves the target config from
 * `agent-admin-service` over HTTP (`GET admin/mcp-servers/:id`, mirroring how
 * `endpoint-call.activity.ts` / `service-call.activity.ts` resolve config from
 * their admin services), applies auth per `auth_type`/`auth_config`, then
 * performs the call.
 *
 * Unlike `agent-ai-service` — which holds long-lived per-tenant MCP
 * connections in `mcp-connection.service.ts` — `connector-runtime` is not a
 * long-lived per-tenant process, so the connection here is EPHEMERAL: connect,
 * call one tool, disconnect, every execution. This matches the transient-probe
 * choice made for the admin-side `mcp-tools-probe.service.ts` (§2.4).
 *
 * Usage is logged fire-and-forget via `@yoizen/shared`'s `reportMcpUsageEvent`
 * (mcp-connections.md §3), the same reusable reporter `tool-bridge.service.ts`
 * uses on the agent side — one usage shape, two producers. `causal` (when the
 * calling workflow's context carries one, mirroring `executeServiceBusCall`/
 * `executeChannelSend`) is threaded into the usage event as
 * `correlationId`/`causationId` (metering-foundation.md G5) — a Temporal
 * `mcpCall` action only ever has workflow-level correlation, never a
 * conversation id, so this is the full attribution available at this call
 * site.
 *
 * Retries (5 attempts, 1s→30s backoff) are applied by the workflow-service
 * proxy that dispatches this activity onto `CONNECTOR_RUNTIME_TASK_QUEUE`,
 * shared with `executeEndpointCall`/`executeServiceCall`.
 */
export async function executeMcpCall(
  args: McpCallArgs,
  tenantId: string,
  causal?: EventCausalContext,
  executionId?: string
): Promise<IMcpCallResult> {
  if (executionId) {
    logger.log(`mcpCall executionId=${executionId} tenant=${tenantId}`);
  }

  if (!args.serverId || args.serverId.length === 0) {
    throw ApplicationFailure.nonRetryable(
      "mcpCall: 'serverId' is required.",
      "INVALID_MCP_CALL_ARGS"
    );
  }
  if (!args.toolName || args.toolName.length === 0) {
    throw ApplicationFailure.nonRetryable(
      "mcpCall: 'toolName' is required.",
      "INVALID_MCP_CALL_ARGS",
      { serverId: args.serverId }
    );
  }

  const breaker = getHttpBreaker();
  const key = computeBreakerKey({
    tenantId,
    kind: "mcp",
    serverId: args.serverId,
  });

  const decision = await breaker.canProceed(key);
  if (decision.action === "deny") {
    // Retryable on purpose: the breaker is a TRANSIENT signal
    // ("downstream is sick, retry later"). `nextRetryDelay` tells
    // Temporal to wait exactly the breaker cooldown before the next
    // attempt, mirroring endpoint-call/service-call semantics.
    throw ApplicationFailure.create({
      message: `Circuit breaker ${decision.status} for MCP call '${args.serverId}' (${decision.reason})`,
      type: "CIRCUIT_OPEN",
      nonRetryable: false,
      nextRetryDelay: HTTP_BREAKER_COOLDOWN_MS,
      details: [{ key, status: decision.status, reason: decision.reason }],
    });
  }

  const server = await resolveServer(args.serverId, tenantId);
  validateUrl(server.url, server.scope);
  const headers = buildAuthHeaders(server);

  const start = Date.now();
  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  try {
    client = await withTimeout(
      createMCPClient({
        transport:
          server.transport_type === "sse"
            ? { type: "sse", url: server.url, headers }
            : { type: "http", url: server.url, headers },
      }),
      MCP_CALL_TIMEOUT_MS
    );

    // `@ai-sdk/mcp@1.x` exposes tools via `client.tools()` (a `name -> Tool`
    // map); there is no lower-level `callTool` on the client in this version.
    // We fetch the set, pick the requested tool, and invoke its `execute`.
    const toolSet = (await withTimeout(
      client.tools(),
      MCP_CALL_TIMEOUT_MS
    )) as unknown as Record<string, McpExecutableTool | undefined>;

    const tool = toolSet[args.toolName];
    if (!tool || typeof tool.execute !== "function") {
      throw ApplicationFailure.nonRetryable(
        `mcpCall: tool '${args.toolName}' is not exposed by MCP server '${server.name}'.`,
        "MCP_TOOL_NOT_FOUND",
        { serverId: server.id, toolName: args.toolName }
      );
    }

    const callResult = await withTimeout(
      tool.execute(args.params ?? {}, {
        toolCallId: `wf-${Date.now()}`,
        messages: [],
        abortSignal: AbortSignal.timeout(MCP_CALL_TIMEOUT_MS),
      }),
      MCP_CALL_TIMEOUT_MS
    );

    const durationMs = Date.now() - start;
    const isError = callResult?.isError === true;
    const resultContent = callResult?.content ?? callResult ?? null;
    reportMcpUsage(server, tenantId, args.toolName, {
      success: !isError,
      durationMs,
      causal,
      executionId,
    });
    // Additive bus event (connection-call-inspector.md T03) — tool args +
    // result content, on top of the scalar-only `reportMcpUsage` above.
    emitMcpCallEvent(server, tenantId, args.toolName, args.params, {
      success: !isError,
      durationMs,
      result: resultContent,
      causal,
    });

    // A reachable server that returns a tool-level error (`isError`) is
    // still a healthy round trip — the breaker guards server
    // availability, not tool correctness — so we count it as success,
    // matching endpoint-call/service-call (which only trip on throws).
    breaker.recordSuccess(key);

    return {
      toolName: args.toolName,
      result: resultContent,
      isError,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    reportMcpUsage(server, tenantId, args.toolName, {
      success: false,
      durationMs,
      error: message,
      causal,
      executionId,
    });
    // Additive bus event — failed tool calls are the interesting ones
    // (T03): emit on failure too, with the error message and no result.
    emitMcpCallEvent(server, tenantId, args.toolName, args.params, {
      success: false,
      durationMs,
      error: message,
      causal,
    });
    breaker.recordFailure(key);
    throw error;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        logger.warn(
          `Failed to close ephemeral MCP connection for '${server.id}': ${closeErr}`
        );
      }
    }
  }
}

/** Resolves the MCP server config from `agent-admin-service`. */
async function resolveServer(
  serverId: string,
  tenantId: string
): Promise<IMcpServerConfig> {
  const url = `${workflowHttpWorkerConfig.agentAdminServiceUrl}/admin/mcp-servers/${encodeURIComponent(serverId)}`;
  const res = await tracedFetch(url, {
    method: "GET",
    headers: { [TENANT_HEADER]: tenantId },
    signal: AbortSignal.timeout(CONFIG_LOOKUP_TIMEOUT_MS),
  });

  if (res.status === 404) {
    throw ApplicationFailure.nonRetryable(
      `mcpCall: MCP server '${serverId}' not found.`,
      "MCP_SERVER_NOT_FOUND",
      { serverId }
    );
  }
  if (!res.ok) {
    throw new Error(
      `mcpCall: failed to resolve MCP server '${serverId}': HTTP ${res.status}`
    );
  }
  return (await res.json()) as IMcpServerConfig;
}

function reportMcpUsage(
  server: IMcpServerConfig,
  tenantId: string,
  toolName: string,
  outcome: {
    success: boolean;
    durationMs: number;
    error?: string;
    causal?: EventCausalContext;
    executionId?: string;
  }
): void {
  reportMcpUsageEvent(workflowHttpWorkerConfig.agentAdminServiceUrl, {
    // One idempotency key per call attempt (metering-foundation.md G4) —
    // generated here, at the point the call is measured, so a retried
    // delivery inside reportMcpUsageEvent resends the same key.
    eventId: randomUUID(),
    tenantId,
    mcpServerId: server.id,
    serverName: server.name,
    toolName,
    success: outcome.success,
    durationMs: outcome.durationMs,
    ...(outcome.error ? { error: outcome.error } : {}),
    correlationId: outcome.causal?.correlation_id,
    causationId: outcome.causal?.causation_id,
    executionId: outcome.executionId,
  });
}

/**
 * Publishes `connector.mcp_call.completed.v1` to the bus
 * (`manual-loops/connectors/connection-call-inspector.md` T03), ADDITIVE to
 * `reportMcpUsage` above — `reportMcpUsageEvent` → agent-admin-service keeps
 * feeding the aggregate usage summary UNCHANGED (decision 3); this is the
 * new per-call capture path that carries the tool's `arguments`/`result`
 * content `reportMcpUsage` never did. Both args and result go through
 * `truncate-body.ts` (8KB) — redaction/truncation parity for the new
 * emission path (SPEC constraint).
 */
function emitMcpCallEvent(
  server: IMcpServerConfig,
  tenantId: string,
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  outcome: {
    success: boolean;
    durationMs: number;
    result?: unknown;
    error?: string;
    causal?: EventCausalContext;
  }
): void {
  publishMcpCallEvent({
    tenantId,
    mcpServerId: server.id,
    serverName: server.name,
    toolName,
    success: outcome.success,
    durationMs: outcome.durationMs,
    ...(outcome.error !== undefined && { error: outcome.error }),
    arguments: truncateBody(toolArgs ?? {}),
    result: truncateBody(outcome.result),
    causal: outcome.causal,
  });
}

/**
 * Injects auth headers per `auth_type`, mirroring
 * `mcp-tools-probe.service.ts`'s `buildHeaders` (Phase 1). Duplicated here
 * rather than shared because `connector-runtime` is a distinct deployable
 * with no import path into `agent-admin-service`. `oauth2` is an explicit
 * non-goal for MCP servers in this phase (mcp-connections.md §0.4).
 */
function buildAuthHeaders(server: IMcpServerConfig): Record<string, string> {
  const headers: Record<string, string> = { ...(server.headers ?? {}) };
  const authConfig = server.auth_config ?? {};

  switch (server.auth_type) {
    case "api-key": {
      const headerName = (authConfig.headerName as string) ?? "X-Api-Key";
      const key = authConfig.key as string;
      if (key && !(headerName in headers)) {
        headers[headerName] = key;
      }
      break;
    }
    case "bearer": {
      const token = (authConfig.token as string) ?? "";
      if (token && !("Authorization" in headers)) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      break;
    }
    case "basic": {
      const username = authConfig.username as string;
      const password = authConfig.password as string;
      if (username && !("Authorization" in headers)) {
        const credentials = Buffer.from(`${username}:${password}`).toString(
          "base64"
        );
        headers["Authorization"] = `Basic ${credentials}`;
      }
      break;
    }
    case "none":
    default:
      break;
  }

  return headers;
}

/**
 * SSRF guard — ported from `mcp-tools-probe.service.ts`'s `validateUrl`
 * (itself ported from `adapter-executor.service.ts`). Rejects non-http(s)
 * schemes, localhost, cloud-metadata, link-local and RFC1918 targets.
 *
 * `scope: "internal"` is an explicit admin opt-in (gated by
 * `MCP_INTERNAL_SCOPE_ENABLED` at write time, agent-admin-service's
 * `mcp-servers.service.ts`) that skips the localhost/RFC1918 checks so
 * private-IP/in-cluster MCP servers can be reached — cloud-metadata and
 * link-local targets stay blocked regardless of scope. Exported for unit
 * testing.
 */
export function validateUrl(
  url: string,
  scope?: "external" | "internal"
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw ApplicationFailure.nonRetryable(
      `mcpCall: invalid MCP server URL: '${url}'`,
      "INVALID_MCP_SERVER_URL",
      { url }
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw ApplicationFailure.nonRetryable(
      `mcpCall: MCP server URL must use http or https protocol: '${url}'`,
      "INVALID_MCP_SERVER_URL",
      { url }
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isInternal = scope === "internal";

  if (
    !isInternal &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
  ) {
    throw ApplicationFailure.nonRetryable(
      "mcpCall: MCP server URL must not target localhost",
      "BLOCKED_MCP_SERVER_URL",
      { url }
    );
  }

  if (hostname === "169.254.169.254") {
    throw ApplicationFailure.nonRetryable(
      "mcpCall: MCP server URL must not target cloud metadata endpoint",
      "BLOCKED_MCP_SERVER_URL",
      { url }
    );
  }

  if (hostname.startsWith("169.254.") || hostname.startsWith("fe80:")) {
    throw ApplicationFailure.nonRetryable(
      "mcpCall: MCP server URL must not target link-local addresses",
      "BLOCKED_MCP_SERVER_URL",
      { url }
    );
  }

  if (isInternal) {
    return;
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number);
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    ) {
      throw ApplicationFailure.nonRetryable(
        "mcpCall: MCP server URL must not target private/RFC1918 addresses",
        "BLOCKED_MCP_SERVER_URL",
        { url }
      );
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`mcpCall timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutHandle!);
  }) as Promise<T>;
}
