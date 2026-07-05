import { randomUUID } from "node:crypto";
import {
  AuthError,
  ConfigError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SdkError,
} from "../domain/errors.js";
import type { FetchLike, FetchResponseLike } from "../infrastructure/http.js";
import { httpJson } from "../infrastructure/http.js";
import type { RetryConfig } from "./retry.js";
import { executeWithRetry, resolveRetryPolicy } from "./retry.js";
import type { Session } from "./session.js";

/** Gateway global prefix is `/api`. `"v1"` (the SDK default) targets the versioned `/api/v1` edge, live for every route family; `null` targets the deprecated unversioned `/api` alias. */
export type ApiVersion = "v1" | null;

export interface CreateTransportDeps {
  fetchImpl: FetchLike;
  baseUrl: string;
  /** Default `x-yoizen-tenant` header value; overridable per request. */
  tenant: string;
  timeoutMs?: number;
  /**
   * Path prefix selector. Defaults to `"v1"` (`/api/v1/...`), live for every
   * route family the SDK calls; pass `null` to target the deprecated
   * unversioned `/api/...` alias instead.
   */
  apiVersion?: ApiVersion;
  /**
   * Bound session used to inject `Authorization: Bearer <token>` when a
   * request has `auth: true` (or defaults to it) and no explicit `token` is
   * passed per-call. Optional: adapters that always pass an explicit token
   * (or only make unauthenticated calls) don't need one bound here.
   */
  session?: Session;
  /** Client-level retry default; per-call `retry` overrides this. */
  retry?: RetryConfig | false;
}

export interface TransportRequestOptions {
  /** Appended directly after the version prefix, e.g. `/channels/accounts?channel=http`. */
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Explicit `x-request-id`; a v4 UUID is generated when omitted. */
  requestId?: string;
  /** Overrides the transport's default tenant for this call. */
  tenant?: string;
  /**
   * Whether this call needs `Authorization: Bearer`. Defaults to `true` when
   * either a bound `session` or an explicit `token` is available, `false`
   * otherwise (e.g. pre-token auth login/refresh).
   */
  auth?: boolean;
  /** Explicit bearer token, takes precedence over the bound session. */
  token?: string;
  /** Sent as `Idempotency-Key`; also flips the default-retry rule for POST. */
  idempotencyKey?: string;
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface TransportResponse<T> {
  status: number;
  body: T;
}

export interface TransportStreamRequestOptions {
  /** Appended directly after the version prefix, e.g. `/runtime/executions/stream`. */
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /**
   * Applies ONLY to opening the connection (time to first response/headers),
   * never to the total stream lifetime — a long-running token stream must
   * not be killed by the same timeout that guards "the server never
   * responded". Defaults to the transport's configured `timeoutMs`.
   */
  timeoutMs?: number;
  /** Explicit `x-request-id`; a v4 UUID is generated when omitted. */
  requestId?: string;
  /** Overrides the transport's default tenant for this call. */
  tenant?: string;
  /** Whether this call needs `Authorization: Bearer`. Defaults like {@link TransportRequestOptions.auth}. */
  auth?: boolean;
  /** Explicit bearer token, takes precedence over the bound session. */
  token?: string;
  /**
   * Aborts the stream at any point in its lifetime (open or already
   * streaming) — unlike `timeoutMs`, this is not time-bounded and stays
   * live for as long as the caller holds the stream open.
   */
  signal?: AbortSignal;
}

export interface TransportStreamResponse {
  status: number;
  /** The raw response body stream, or `null` if the server sent no body. */
  body: ReadableStream<Uint8Array> | null;
}

export interface Transport {
  request<T = unknown>(
    options: TransportRequestOptions
  ): Promise<TransportResponse<T>>;
  /**
   * Opens a `text/event-stream` connection. No retry (streams are not safely
   * retryable mid-flight) and no JSON parsing of the body — callers pipe
   * `body` through `core/sse.ts` themselves. See `TransportStreamRequestOptions.timeoutMs`
   * for the connection-open-only timeout semantics.
   */
  requestStream(
    options: TransportStreamRequestOptions
  ): Promise<TransportStreamResponse>;
}

function versionPrefix(apiVersion: ApiVersion | undefined): string {
  return apiVersion === "v1" ? "/api/v1" : "/api";
}

/** Maps a non-2xx HTTP status to the SDK's typed error taxonomy (401 stays `AuthError`). */
function mapStatusToError(
  status: number,
  body: unknown,
  retryAfterMs: number | undefined
): SdkError {
  const details = { httpStatus: status, body };
  switch (status) {
    case 401:
      return new AuthError("request failed: unauthorized", { details });
    case 403:
      return new PermissionError("request failed: forbidden", { details });
    case 404:
      return new NotFoundError("request failed: not found", { details });
    case 409:
      return new ConflictError("request failed: conflict", { details });
    case 429:
      return new RateLimitError("request failed: rate limited", {
        details,
        retryAfterMs,
      });
    default:
      return new SdkError(`request failed with status ${status}`, {
        code: "HTTP",
        details,
      });
  }
}

/**
 * Authenticated request helper over {@link httpJson}. Injects the
 * `Authorization`, `x-yoizen-tenant`, and `x-request-id` headers, applies the
 * configured API-version path prefix, maps HTTP status to typed errors, and
 * wraps every attempt in the shared retry policy. Supports unauthenticated
 * calls (`auth: false`) for the pre-token auth login/refresh endpoints.
 */
export function createTransport({
  fetchImpl,
  baseUrl,
  tenant: defaultTenant,
  timeoutMs: defaultTimeoutMs = 10_000,
  apiVersion,
  session,
  retry: clientRetry,
}: CreateTransportDeps): Transport {
  const prefix = versionPrefix(apiVersion);

  async function request<T>(
    options: TransportRequestOptions
  ): Promise<TransportResponse<T>> {
    const method = (options.method ?? "GET").toUpperCase();
    const requiresAuth = options.auth ?? Boolean(session ?? options.token);
    if (requiresAuth && !session && !options.token) {
      throw new ConfigError(
        "transport: request requires auth but no session or explicit token was provided"
      );
    }

    const requestId = options.requestId ?? randomUUID();

    async function attempt(): Promise<TransportResponse<T>> {
      const headers: Record<string, string> = { ...options.headers };
      headers["x-yoizen-tenant"] = options.tenant ?? defaultTenant;
      headers["x-request-id"] = requestId;
      if (options.idempotencyKey) {
        headers["Idempotency-Key"] = options.idempotencyKey;
      }
      if (requiresAuth) {
        const bearer =
          options.token ?? (await session!.ensureToken()).accessToken;
        headers.Authorization = `Bearer ${bearer}`;
      }

      const result = await httpJson(fetchImpl, {
        url: `${baseUrl}${prefix}${options.path}`,
        method,
        headers,
        body: options.body,
        timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
      });

      if (!result.ok) {
        throw mapStatusToError(result.status, result.body, result.retryAfterMs);
      }

      return { status: result.status, body: result.body as T };
    }

    const policy = resolveRetryPolicy({
      method,
      idempotencyKey: options.idempotencyKey,
      clientRetry,
      callRetry: options.retry,
    });

    return executeWithRetry(attempt, policy);
  }

  async function requestStream(
    options: TransportStreamRequestOptions
  ): Promise<TransportStreamResponse> {
    const method = (options.method ?? "POST").toUpperCase();
    const requiresAuth = options.auth ?? Boolean(session ?? options.token);
    if (requiresAuth && !session && !options.token) {
      throw new ConfigError(
        "transport: requestStream requires auth but no session or explicit token was provided"
      );
    }

    const requestId = options.requestId ?? randomUUID();
    const headers: Record<string, string> = { ...options.headers };
    headers["x-yoizen-tenant"] = options.tenant ?? defaultTenant;
    headers["x-request-id"] = requestId;
    headers.Accept = "text/event-stream";

    let payload: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(options.body);
    }

    if (requiresAuth) {
      const bearer =
        options.token ?? (await session!.ensureToken()).accessToken;
      headers.Authorization = `Bearer ${bearer}`;
    }

    // `timeoutMs` guards ONLY the time-to-first-response (connection open) —
    // once `fetchImpl` resolves with headers, the timer below is cleared so
    // it can never abort an in-progress token stream. `options.signal`, by
    // contrast, stays wired to the underlying fetch for the full lifetime of
    // the stream (open AND read), so callers can cancel mid-stream.
    const controller = new AbortController();
    const forwardExternalAbort = (): void => {
      controller.abort(options.signal!.reason);
    };
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener("abort", forwardExternalAbort, {
          once: true,
        });
      }
    }

    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const openTimer = setTimeout(() => {
      controller.abort(
        new DOMException(
          `stream open timed out after ${timeoutMs}ms`,
          "TimeoutError"
        )
      );
    }, timeoutMs);

    let res: FetchResponseLike;
    try {
      res = await fetchImpl(`${baseUrl}${prefix}${options.path}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(openTimer);
      if (options.signal?.aborted) {
        // Genuine caller-initiated abort during connection open: propagate
        // as-is so `runtime.stream()` can recognize it as an AbortError and
        // end the iterator cleanly instead of throwing.
        throw err;
      }
      throw new SdkError(
        `network error opening stream ${method} ${options.path}`,
        { code: "NETWORK", cause: err }
      );
    }
    // Headers are in: the connection-open window is over. Clear the timer so
    // it can't fire later and abort an otherwise-healthy in-progress stream.
    clearTimeout(openTimer);

    if (res.status === 404 || res.status === 405) {
      if (options.signal) {
        options.signal.removeEventListener("abort", forwardExternalAbort);
      }
      throw new SdkError(
        "streaming is not supported by this gateway/version " +
          `(got HTTP ${res.status} opening ${method} ${options.path}) — ` +
          "fall back to createExecution() + poll getExecution()",
        { code: "streaming_unsupported", details: { httpStatus: res.status } }
      );
    }

    if (!res.ok) {
      if (options.signal) {
        options.signal.removeEventListener("abort", forwardExternalAbort);
      }
      const text = await res.text().catch(() => "");
      let body: unknown = text;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      throw mapStatusToError(res.status, body, undefined);
    }

    return { status: res.status, body: res.body ?? null };
  }

  return { request, requestStream };
}
