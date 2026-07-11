// to-chain-response.ts — shapes raw event/span rows (as returned by the
// queries built in build-chain-query.ts / build-spans-query.ts) into the
// console-facing chain response. Pure function: no I/O, no DB client — a
// later task's src/main.ts passes it the rows the driver returned.

import type { ChainEventRow } from "./build-chain-query.js";
import type { ChainSpanRow } from "./build-spans-query.js";

export interface ChainSummary {
  readonly count: number;
  readonly first_at: string | null;
  readonly last_at: string | null;
  readonly total_ms: number;
  readonly orphan_count: number;
}

export interface ChainResponse {
  readonly correlation_id: string;
  readonly tenant: string | null;
  readonly events: readonly ChainEventRow[];
  readonly spans: readonly ChainSpanRow[];
  readonly summary: ChainSummary;
}

/**
 * Shapes the chain response for `correlationId`/`tenant` from the event and
 * span rows already fetched for it.
 *
 * `summary.orphan_count` (SPEC.md T01) counts events whose `causation_id` is
 * non-null and not present as an `event_id` anywhere in this same event set
 * — i.e. events whose causal parent fell outside the fetched chain (either a
 * true root-less orphan, or a parent excluded by the tenant scope).
 *
 * `summary.first_at`/`last_at`/`total_ms` are derived from `occurred_at`
 * across all events, independent of ordering guarantees from the query.
 */
export function toChainResponse(
  correlationId: string,
  tenant: string | null,
  events: readonly ChainEventRow[],
  spans: readonly ChainSpanRow[]
): ChainResponse {
  const eventIds = new Set(events.map((event) => event.event_id));

  const orphanCount = events.filter(
    (event) => event.causation_id !== null && !eventIds.has(event.causation_id)
  ).length;

  const occurredAtMs = events.map((event) => Date.parse(event.occurred_at));
  const firstAtMs = occurredAtMs.length > 0 ? Math.min(...occurredAtMs) : null;
  const lastAtMs = occurredAtMs.length > 0 ? Math.max(...occurredAtMs) : null;

  return {
    correlation_id: correlationId,
    tenant,
    events,
    spans,
    summary: {
      count: events.length,
      first_at: firstAtMs === null ? null : new Date(firstAtMs).toISOString(),
      last_at: lastAtMs === null ? null : new Date(lastAtMs).toISOString(),
      total_ms:
        firstAtMs === null || lastAtMs === null ? 0 : lastAtMs - firstAtMs,
      orphan_count: orphanCount,
    },
  };
}
