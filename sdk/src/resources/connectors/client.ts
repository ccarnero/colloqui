import type { Paginated } from "../../core/pagination.js";
import { paginate, toSinglePage } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import { ValidationError } from "../../domain/errors.js";
import type {
  Connector,
  ConnectorAsyncInvokeAccepted,
  ConnectorEndpoint,
  ConnectorInvocationStatus,
  ConnectorInvokeArgs,
  ConnectorInvokeOptions,
  ConnectorSyncInvokeResult,
  ConnectorUsageParams,
  ConnectorUsageResult,
  CreateConnectorEndpointInput,
  CreateConnectorInput,
  ListConnectorsParams,
  UpdateConnectorEndpointInput,
  UpdateConnectorInput,
} from "./types.js";

export interface ConnectorsClientDeps {
  transport: Transport;
}

export interface ConnectorCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

/**
 * `connectors.invocations` — polling fallback for async invoke results
 * (`manual-loops/connector-invoke-api.md` T05/T06). See `types.ts`'s
 * "polling TTL default 15m" doc comment before relying on this past the
 * result-parking window.
 */
export interface ConnectorInvocationsClient {
  /**
   * `GET /connectors/invocations/:invocationId`. Rejects with
   * `NotFoundError` (404) once the invocation is unknown OR its result has
   * expired past the polling TTL — both collapse onto the same response,
   * there is no way to distinguish "never existed" from "expired" (see
   * `types.ts`).
   */
  get(
    invocationId: string,
    opts?: ConnectorCallOptions
  ): Promise<ConnectorInvocationStatus>;
}

export interface ConnectorsClient {
  /** `POST /connectors` — create a connector (external third-party API or internal adapter mirror). */
  create(
    input: CreateConnectorInput,
    opts?: ConnectorCallOptions
  ): Promise<Connector>;
  /**
   * `GET /connectors` — bare array today (the gateway never forwards
   * limit/offset), degraded to a single page. See `types.ts` for the `name`
   * filter gap.
   */
  list(params?: ListConnectorsParams): Paginated<Connector>;
  /** `GET /connectors/usage` — per-connector call stats over a rolling window. */
  usage(
    params?: ConnectorUsageParams,
    opts?: ConnectorCallOptions
  ): Promise<ConnectorUsageResult>;
  /** `GET /connectors/:id`. */
  get(id: string, opts?: ConnectorCallOptions): Promise<Connector>;
  /**
   * `PATCH /connectors/:id`. Rejects with `ConflictError` (409) when the
   * update targets a registry-managed adapter's locked fields — see
   * `types.ts`.
   */
  update(
    id: string,
    input: UpdateConnectorInput,
    opts?: ConnectorCallOptions
  ): Promise<Connector>;
  /**
   * `DELETE /connectors/:id`; resolves on 204. Rejects with `ConflictError`
   * for a registry-managed adapter (can't be deleted manually — see
   * `types.ts`).
   */
  remove(id: string, opts?: ConnectorCallOptions): Promise<void>;
  /**
   * `POST /connectors/:id/endpoints` — add an endpoint. `(method, path)`
   * must be unique per connector; a duplicate 409s.
   */
  addEndpoint(
    id: string,
    input: CreateConnectorEndpointInput,
    opts?: ConnectorCallOptions
  ): Promise<ConnectorEndpoint>;
  /** `PATCH /connectors/:id/endpoints/:epId`. */
  updateEndpoint(
    id: string,
    endpointId: string,
    input: UpdateConnectorEndpointInput,
    opts?: ConnectorCallOptions
  ): Promise<ConnectorEndpoint>;
  /** `DELETE /connectors/:id/endpoints/:epId`; resolves on 204. */
  removeEndpoint(
    id: string,
    endpointId: string,
    opts?: ConnectorCallOptions
  ): Promise<void>;
  /**
   * `POST /connectors/:connectorId/endpoints/:endpointId/invoke` — runs the
   * SAME governed pipe (breaker, cache, audit event) workflows use, from
   * code. Defaults to `mode: "sync"` (200, the result inline). Pass
   * `{ mode: "async" }` to get a `202 { invocationId }` accept instead — the
   * request travels over NATS JetStream to a durable consumer, and the
   * result is delivered by webhook (if `opts.webhook` is supplied) with
   * `connectors.invocations.get(invocationId)` as the polling fallback.
   *
   * IMPORTANT — read `types.ts`'s doc comment on `ConnectorInvokeOptions`
   * before using `mode: "async"` in production: async delivery is
   * at-least-once (JetStream redelivery can repeat the OUTBOUND HTTP call),
   * so pass `idempotencyKey` for any non-idempotent underlying verb.
   *
   * Overloaded on `opts.mode` so the return type is `ConnectorSyncInvokeResult`
   * for the (default) sync call and `ConnectorAsyncInvokeAccepted` when
   * `mode: "async"` is explicit — no runtime discriminant needed by callers
   * who set `mode` as a literal.
   */
  invoke(
    connectorId: string,
    endpointId: string,
    args: ConnectorInvokeArgs,
    opts?: (Omit<ConnectorInvokeOptions, "mode"> & { mode?: "sync" }) &
      ConnectorCallOptions
  ): Promise<ConnectorSyncInvokeResult>;
  invoke(
    connectorId: string,
    endpointId: string,
    args: ConnectorInvokeArgs,
    opts: Omit<ConnectorInvokeOptions, "mode"> & {
      mode: "async";
    } & ConnectorCallOptions
  ): Promise<ConnectorAsyncInvokeAccepted>;
  /** `connectors.invocations` — polling fallback for async invoke results. */
  invocations: ConnectorInvocationsClient;
}

/**
 * Creates the `connectors` namespace client. Follows the `workflows`
 * reference implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md
 * "Resource clients".
 */
export function createConnectorsClient({
  transport,
}: ConnectorsClientDeps): ConnectorsClient {
  function encodePath(id: string): string {
    return encodeURIComponent(id);
  }

  function toQuery(
    params: Record<string, string | number | undefined>
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return qs.length > 0 ? `?${qs}` : "";
  }

  async function create(
    input: CreateConnectorInput,
    opts: ConnectorCallOptions = {}
  ): Promise<Connector> {
    const { body } = await transport.request<Connector>({
      path: "/connectors",
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  function list(params: ListConnectorsParams = {}): Paginated<Connector> {
    return paginate<Connector>(async () => {
      const { body } = await transport.request<Connector[]>({
        path: `/connectors${toQuery({
          context: params.context,
          tag: params.tag,
        })}`,
        method: "GET",
      });
      return toSinglePage(body);
    });
  }

  async function usage(
    params: ConnectorUsageParams = {},
    opts: ConnectorCallOptions = {}
  ): Promise<ConnectorUsageResult> {
    const { body } = await transport.request<ConnectorUsageResult>({
      path: `/connectors/usage${toQuery({ window: params.window })}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function get(
    id: string,
    opts: ConnectorCallOptions = {}
  ): Promise<Connector> {
    const { body } = await transport.request<Connector>({
      path: `/connectors/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  async function update(
    id: string,
    input: UpdateConnectorInput,
    opts: ConnectorCallOptions = {}
  ): Promise<Connector> {
    const { body } = await transport.request<Connector>({
      path: `/connectors/${encodePath(id)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function remove(
    id: string,
    opts: ConnectorCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/connectors/${encodePath(id)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function addEndpoint(
    id: string,
    input: CreateConnectorEndpointInput,
    opts: ConnectorCallOptions = {}
  ): Promise<ConnectorEndpoint> {
    const { body } = await transport.request<ConnectorEndpoint>({
      path: `/connectors/${encodePath(id)}/endpoints`,
      method: "POST",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function updateEndpoint(
    id: string,
    endpointId: string,
    input: UpdateConnectorEndpointInput,
    opts: ConnectorCallOptions = {}
  ): Promise<ConnectorEndpoint> {
    const { body } = await transport.request<ConnectorEndpoint>({
      path: `/connectors/${encodePath(id)}/endpoints/${encodePath(endpointId)}`,
      method: "PATCH",
      body: input,
      retry: opts.retry,
    });
    return body;
  }

  async function removeEndpoint(
    id: string,
    endpointId: string,
    opts: ConnectorCallOptions = {}
  ): Promise<void> {
    await transport.request<void>({
      path: `/connectors/${encodePath(id)}/endpoints/${encodePath(endpointId)}`,
      method: "DELETE",
      retry: opts.retry,
    });
  }

  async function invoke(
    connectorId: string,
    endpointId: string,
    args: ConnectorInvokeArgs,
    opts: ConnectorInvokeOptions & ConnectorCallOptions = {}
  ): Promise<ConnectorSyncInvokeResult | ConnectorAsyncInvokeAccepted> {
    const mode = opts.mode ?? "sync";
    if (opts.webhook !== undefined && mode !== "async") {
      // Client-side guard (mirrors the facade's own 400 for the same
      // misuse, `parse-invoke-request-body.ts`) — fail fast instead of a
      // round trip that will always 400.
      throw new ValidationError('webhook is only valid for mode: "async"');
    }

    const body: {
      args: ConnectorInvokeArgs;
      mode: "sync" | "async";
      idempotencyKey?: string;
      webhook?: ConnectorInvokeOptions["webhook"];
    } = { args, mode };
    if (opts.idempotencyKey !== undefined) {
      body.idempotencyKey = opts.idempotencyKey;
    }
    if (opts.webhook !== undefined) {
      body.webhook = opts.webhook;
    }

    const { body: responseBody } = await transport.request<
      ConnectorSyncInvokeResult | ConnectorAsyncInvokeAccepted
    >({
      path: `/connectors/${encodePath(connectorId)}/endpoints/${encodePath(endpointId)}/invoke`,
      method: "POST",
      body,
      retry: opts.retry,
    });
    return responseBody;
  }

  async function invocationsGet(
    invocationId: string,
    opts: ConnectorCallOptions = {}
  ): Promise<ConnectorInvocationStatus> {
    const { body } = await transport.request<ConnectorInvocationStatus>({
      path: `/connectors/invocations/${encodePath(invocationId)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  return {
    create,
    list,
    usage,
    get,
    update,
    remove,
    addEndpoint,
    updateEndpoint,
    removeEndpoint,
    invoke: invoke as ConnectorsClient["invoke"],
    invocations: { get: invocationsGet },
  };
}
