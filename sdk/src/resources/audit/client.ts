import type { PageResult, Paginated } from "../../core/pagination.js";
import { paginate } from "../../core/pagination.js";
import type { RetryConfig } from "../../core/retry.js";
import type { Transport } from "../../core/transport.js";
import type {
  AuditEvent,
  ChannelEvent,
  QueryAuditEventsParams,
  QueryChannelEventsParams,
} from "./types.js";

export interface AuditClientDeps {
  transport: Transport;
}

export interface AuditCallOptions {
  /** Per-call retry override; `false` disables retries for this call only. */
  retry?: RetryConfig | false;
}

export interface AuditEventsClient {
  /**
   * `GET /audit/events` — the gateway's list envelope
   * (`{ events, limit, offset }`) carries NO `total`, so `hasMore` is a
   * heuristic (`items.length === limit`) — see `types.ts`.
   */
  list(params?: QueryAuditEventsParams): Paginated<AuditEvent>;
  /** `GET /audit/events/:id`. */
  get(id: string, opts?: AuditCallOptions): Promise<AuditEvent>;
}

export interface AuditChannelEventsClient {
  /**
   * `GET /audit/channel-events` — same no-`total` heuristic as
   * `events.list()`, see `types.ts`.
   */
  list(params?: QueryChannelEventsParams): Paginated<ChannelEvent>;
  /** `GET /audit/channel-events/:id`. */
  get(id: string, opts?: AuditCallOptions): Promise<ChannelEvent>;
}

export interface AuditClient {
  events: AuditEventsClient;
  channelEvents: AuditChannelEventsClient;
}

/**
 * Creates the `audit` namespace client. Follows the `workflows` reference
 * implementation (GROWTH-PLAN.md Phase 2) — see sdk/README.md "Resource
 * clients". Does NOT expose a chain/correlation lookup — see `types.ts`.
 */
export function createAuditClient({ transport }: AuditClientDeps): AuditClient {
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

  /** No `total` in this envelope — degrade to a `hasMore` heuristic. */
  function toNoTotalPage<T>(
    items: T[],
    limit: number,
    offset: number
  ): PageResult<T> {
    return {
      items,
      hasMore: items.length === limit,
      nextOffset: offset + items.length,
    };
  }

  function eventsList(
    params: QueryAuditEventsParams = {}
  ): Paginated<AuditEvent> {
    return paginate<AuditEvent>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        events: AuditEvent[];
        limit: number;
        offset: number;
      }>({
        path: `/audit/events${toQuery({
          type: params.type,
          from: params.from,
          to: params.to,
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toNoTotalPage(body.events, body.limit, body.offset);
    });
  }

  async function eventsGet(
    id: string,
    opts: AuditCallOptions = {}
  ): Promise<AuditEvent> {
    const { body } = await transport.request<AuditEvent>({
      path: `/audit/events/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  function channelEventsList(
    params: QueryChannelEventsParams = {}
  ): Paginated<ChannelEvent> {
    return paginate<ChannelEvent>(async ({ limit, offset }) => {
      const { body } = await transport.request<{
        events: ChannelEvent[];
        limit: number;
        offset: number;
      }>({
        path: `/audit/channel-events${toQuery({
          channel: params.channel,
          kind: params.kind,
          accountId: params.accountId,
          from: params.from,
          to: params.to,
          limit: params.limit ?? limit,
          offset: params.offset ?? offset,
        })}`,
        method: "GET",
      });
      return toNoTotalPage(body.events, body.limit, body.offset);
    });
  }

  async function channelEventsGet(
    id: string,
    opts: AuditCallOptions = {}
  ): Promise<ChannelEvent> {
    const { body } = await transport.request<ChannelEvent>({
      path: `/audit/channel-events/${encodePath(id)}`,
      method: "GET",
      retry: opts.retry,
    });
    return body;
  }

  return {
    events: { list: eventsList, get: eventsGet },
    channelEvents: { list: channelEventsList, get: channelEventsGet },
  };
}
