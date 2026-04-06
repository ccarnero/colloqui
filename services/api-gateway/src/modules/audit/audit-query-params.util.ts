import type {
  QueryAuditEventsProxyDto,
  QueryChannelEventsProxyDto,
} from "./audit-proxy-query.dto";

function numToQuery(v: number | undefined): string | undefined {
  return v === undefined ? undefined : String(v);
}

/** Maps validated DTO to string query record for upstream URLSearchParams. */
export function auditEventsToParams(
  q: QueryAuditEventsProxyDto,
): Record<string, string | undefined> {
  return {
    type: q.type,
    from: q.from,
    to: q.to,
    limit: numToQuery(q.limit),
    offset: numToQuery(q.offset),
  };
}

/** Maps validated DTO to string query record for upstream URLSearchParams. */
export function channelEventsToParams(
  q: QueryChannelEventsProxyDto,
): Record<string, string | undefined> {
  return {
    channel: q.channel,
    kind: q.kind,
    accountId: q.accountId,
    from: q.from,
    to: q.to,
    limit: numToQuery(q.limit),
    offset: numToQuery(q.offset),
  };
}
