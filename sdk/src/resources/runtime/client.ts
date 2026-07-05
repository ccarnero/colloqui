import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  CreateExecutionInput,
  CreateExecutionResult,
  ExecutionStatus,
  RuntimeHealth,
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
}

/**
 * Creates the `runtime` namespace client (`runtime/executions`). Follows the
 * `workflows` resource pattern (GROWTH-PLAN.md Phase 2) — see
 * sdk/README.md "Resource clients". Deliberately has no `stream()` method —
 * see `./types.ts` for the verified streaming gap (gateway proxies neither
 * downstream SSE route).
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

  return { createExecution, getExecution, health };
}
