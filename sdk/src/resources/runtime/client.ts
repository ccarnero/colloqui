import type { RetryConfig } from "../../core/retry.js";
import { parseSseStream } from "../../core/sse.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateExecutionInput,
  CreateExecutionResult,
  ExecutionStatus,
  RuntimeHealth,
  RuntimeStreamEvent,
  RuntimeStreamOptions,
} from "./types.js";

export interface RuntimeClientDeps {
  transport: Transport;
}

export interface RuntimeCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface RuntimeClient {
  /** `POST /runtime/executions` — starts an agent execution; 202 Accepted. */
  createExecution(
    input: CreateExecutionInput,
    opts?: RuntimeCallOptions
  ): Promise<CreateExecutionResult>;
  /** `GET /runtime/executions/:id`. */
  getExecution(id: string, opts?: RuntimeCallOptions): Promise<ExecutionStatus>;
  /** `GET /runtime/health` — public, unauthenticated. */
  health(opts?: RuntimeCallOptions): Promise<RuntimeHealth>;
  /**
   * `POST /runtime/executions/stream` — combined submit+stream: starts an
   * agent execution and yields `started` → (`token` | `tool_call` |
   * `tool_result`)* → (`completed` | `failed`) as an async iterable. See
   * `./types.ts` for the verified wire shapes.
   *
   * `failed` is a normal, non-throwing terminal event (design doc §2.3/§4.3)
   * — the iterator simply ends after yielding it. Only connection-level
   * problems throw `SdkError`:
   *
   * - `code: "streaming_unsupported"` when the stream route 404s/405s
   *   (no server-side capability flag exists to probe in advance — see
   *   `./types.ts` for why). Callers that want automatic degradation should
   *   catch this and fall back to polling, e.g.:
   *
   *   ```ts
   *   try {
   *     for await (const ev of client.runtime.stream(input)) { ... }
   *   } catch (err) {
   *     if (err instanceof SdkError && err.code === "streaming_unsupported") {
   *       const { executionId } = await client.runtime.createExecution(input);
   *       // then poll client.runtime.getExecution(executionId)
   *     } else throw err;
   *   }
   *   ```
   * - any other transport/network error opening the connection.
   *
   * Passing `opts.signal` and aborting it ends the iterator cleanly (no
   * throw) at any point, whether the connection is still opening or already
   * streaming tokens.
   */
  stream(
    input: CreateExecutionInput,
    opts?: RuntimeStreamOptions
  ): AsyncIterable<RuntimeStreamEvent>;
}

const STREAM_EVENT_TYPES = new Set<RuntimeStreamEvent["type"]>([
  "started",
  "token",
  "tool_call",
  "tool_result",
  "completed",
  "failed",
]);

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      (err as { code?: unknown }).code === "ABORT_ERR")
  );
}

/**
 * Creates the `runtime` namespace client (`runtime/executions`). Follows the
 * `workflows` resource pattern (GROWTH-PLAN.md Phase 2) — see
 * sdk/README.md "Resource clients".
 */
export function createRuntimeClient({
  transport,
}: RuntimeClientDeps): RuntimeClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  async function createExecution(
    input: CreateExecutionInput,
    opts: RuntimeCallOptions = {}
  ): Promise<CreateExecutionResult> {
    const { body } = await transport.request<CreateExecutionResult>({
      path: "/runtime/executions",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function getExecution(
    id: string,
    opts: RuntimeCallOptions = {}
  ): Promise<ExecutionStatus> {
    const { body } = await transport.request<ExecutionStatus>({
      path: `/runtime/executions/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function health(opts: RuntimeCallOptions = {}): Promise<RuntimeHealth> {
    const { body } = await transport.request<RuntimeHealth>({
      path: "/runtime/health",
      method: "GET",
      auth: false,
      retry: opts.retry,
    });
    return body;
  }

  async function* stream(
    input: CreateExecutionInput,
    opts: RuntimeStreamOptions = {}
  ): AsyncGenerator<RuntimeStreamEvent, void, unknown> {
    let response: Awaited<ReturnType<Transport["requestStream"]>>;
    try {
      response = await transport.requestStream({
        path: "/runtime/executions/stream",
        method: "POST",
        body: input,
        signal: opts.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      throw err;
    }

    if (!response.body) {
      return;
    }

    try {
      for await (const frame of parseSseStream(response.body)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          // Malformed frame from the relay — skip rather than crash the
          // whole stream over one bad event.
          continue;
        }

        const type = frame.event ?? (parsed as { type?: string })?.type;
        if (
          typeof type !== "string" ||
          !STREAM_EVENT_TYPES.has(type as never)
        ) {
          continue;
        }

        const event = { type, data: parsed } as RuntimeStreamEvent;
        yield event;

        if (event.type === "failed" || event.type === "completed") {
          return;
        }
      }
    } catch (err) {
      if (isAbortError(err) || opts.signal?.aborted) {
        return;
      }
      throw err;
    }
  }

  return { createExecution, getExecution, health, stream };
}
