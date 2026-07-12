// aggregate-run-cast.ts — pure aggregation of a run's distinct `cast`
// instances (connector/agent/channel/tool) from its fetched event rows
// (T01 of manual-loops/run-view.md). No I/O, no DB client.
//
// Field provenance (see build-run-events-query.ts's header for the full
// investigation):
//   - connector: `connector_id` column (rule 11 connector-invocation events
//     that share the run's correlation, e.g. an `endpointCall` hop through
//     connector-runtime) OR `payload_connector_id` (the step event's own
//     `connectorId`, for `action_started`/`action_completed` on
//     `endpointCall`/`serviceCall`/`mcpCall` actions).
//   - agent: `payload_agent_id` (`action_started`/`action_completed` on
//     `agentCall` actions). No dedicated column exists today.
//   - channel: the chain's ingress/egress/processing events (TAXONOMY.md §4
//     rules 2-5) — `tech` IS the channel token (e.g. "whatsapp",
//     "http-generic"). There is no channel-ACCOUNT id/name surfaced on the
//     projected columns, so `id === name === tech` (documented gap — a
//     future task could join `channel_accounts` by `accountid`, which IS on
//     the envelope but not projected here).
//   - tool: no tool-invocation event family exists in the taxonomy yet
//     (TAXONOMY.md has no `mcpCall`/tool rule distinct from connector); this
//     aggregator never emits a "tool" entry today — SPEC.md T01 explicitly
//     allows "future, empty ok".
//
// CROSS-RUN-LEAKAGE FIX (T01 attempt 2, manual-loops/run-view.md): connector
// and agent instances MUST come from the run's OWN step events only
// (`runEvents`, already scoped by `scope-run-events.ts`'s causation-id
// filter) — aggregating them over the whole correlation would re-introduce
// the exact leakage this attempt fixes (a sibling run's `endpointCall`/
// `agentCall` step counted against this run's cast). Channel, by contrast,
// is deliberately read from a SEPARATE, wider `channelEvents` argument
// (the full correlation fetch, unscoped): the trigger/ingress event that
// established the channel is NOT one of this run's own step events (it is
// the shared upstream cause of every sibling run), yet it IS the only place
// the channel account information lives — SPEC.md's documented design
// choice ("aggregate channel cast from the trigger event") explicitly
// allows this one field to be correlation-wide rather than run-scoped.
// `channelEvents` defaults to `runEvents` so every existing single-array
// call site (and this file's own tests) keeps its prior behavior.

import type { RunEventRow } from "./build-run-events-query.js";

export type CastKind = "connector" | "agent" | "channel" | "tool";

export interface CastEntry {
  readonly kind: CastKind;
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

// Business functions that mark a channel ingress/egress/processing event.
// TAXONOMY.md §4 rules 2 (ingress), 3/5 (channel-processing), 4
// (channel-egress).
const CHANNEL_BUSINESS_FNS = new Set([
  "ingress",
  "channel-processing",
  "channel-egress",
]);

/**
 * Aggregates distinct `{kind, id, name, count}` cast instances. `events`
 * (the run's OWN, causation-scoped events) drives connector/agent entries;
 * `channelEvents` (defaults to `events`) drives channel entries — see this
 * file's header for why the two are deliberately allowed to differ. Order
 * of first appearance is preserved (stable for snapshot tests); `count` is
 * the number of events referencing that instance.
 */
export function aggregateRunCast(
  events: readonly RunEventRow[],
  channelEvents: readonly RunEventRow[] = events
): readonly CastEntry[] {
  const byKey = new Map<string, CastEntry>();

  const bump = (kind: CastKind, id: string | null, name?: string): void => {
    if (id === null || id.length === 0) {
      return;
    }
    const key = `${kind}:${id}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, count: existing.count + 1 });
      return;
    }
    byKey.set(key, { kind, id, name: name ?? id, count: 1 });
  };

  for (const event of events) {
    // Connector: prefer the rule-11 connector-invocation column, fall back
    // to the step event's own payload field — the two are never both
    // non-null on the same row (different event families).
    bump("connector", event.connector_id ?? event.payload_connector_id);

    // Agent: payload-only surface (no dedicated column).
    bump("agent", event.payload_agent_id);
  }

  for (const event of channelEvents) {
    // Channel: keyed by `tech` (the channel token) for ingress/egress/
    // processing events only.
    if (CHANNEL_BUSINESS_FNS.has(event.business_fn)) {
      bump("channel", event.tech);
    }
  }

  return [...byKey.values()];
}
