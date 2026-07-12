// waterfall-geometry.ts — pure geometry/matching helpers for the waterfall
// view. Kept separate from the component so they stay unit-testable without
// TestBed, mirroring the sparkline precedent's computed()-only geometry.
import type {
  ITrackedEvent,
  ITrackedEventSpan,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";
import { type BusinessFnGroup, businessFnGroup } from "./business-fn-group";

/** One row of the waterfall grid — an event, positioned on the time axis. */
export interface IWaterfallRow {
  readonly eventId: string;
  readonly label: string;
  readonly service: string;
  readonly depth: number;
  readonly group: BusinessFnGroup;
  readonly startMs: number;
  readonly durationMs: number;
  readonly isPoint: boolean;
  readonly startPercent: number;
  readonly widthPercent: number;
}

/** Bottleneck summary shown in the header chips. */
export interface IWaterfallBottleneck {
  readonly eventId: string;
  readonly label: string;
  readonly durationMs: number;
  readonly percentOfTotal: number;
}

/** `kind` with a trailing `_started`/`_completed` verb stripped, matching the
 * ingester's `span-pairs.sql` `kind_prefix` derivation. Point-event kinds
 * (no verb suffix) pass through unchanged. */
export function eventKindPrefix(event: ITrackedEvent): string | null {
  if (!event.kind) {
    return null;
  }
  return event.kind.replace(/_(started|completed)$/, "");
}

/** Best-effort entity id carried by an event — mirrors the first two terms of
 * `span-pairs.sql`'s COALESCE (`run_id`, `workflow_id`; see
 * `services/tracking-ingester-service/src/sql/span-pairs.sql` ~L48-53).
 * The COALESCE's remaining terms — `execution_id`, `executionId`, `call_id`
 * — live only in the raw envelope payload and are NOT exposed on
 * `ITrackedEvent`, so they cannot be read here.
 *
 * `connector_id` is deliberately NOT part of this fallback chain: it is a
 * connector/adapter identifier, not the span's per-call pairing key (which
 * is `call_id`), so matching on it would essentially never hit for
 * connector-invocation events. When an event carries none of the exposed
 * entity-id fields, matching falls back to `kind_prefix`-only (see
 * `matchEventSpans`) rather than guessing with an incorrect field. */
export function eventEntityId(event: ITrackedEvent): string | null {
  return event.run_id ?? event.workflow_id ?? null;
}

/**
 * Matches each event to its span, by `kind_prefix`/`entity_id` (SPEC T05).
 * Spans carry no `event_id`, so matching is greedy and order-preserving:
 * events are walked in chain order and each consumes the first still-free
 * span whose `kind_prefix` matches and whose `entity_id` matches (or is null
 * on either side — point events typically have no entity id).
 */
export function matchEventSpans(
  events: readonly ITrackedEvent[],
  spans: readonly ITrackedEventSpan[]
): ReadonlyMap<string, ITrackedEventSpan | null> {
  const remaining = [...spans];
  const result = new Map<string, ITrackedEventSpan | null>();

  for (const event of events) {
    const prefix = eventKindPrefix(event);
    const entityId = eventEntityId(event);

    const idx = remaining.findIndex((span) => {
      if (span.kind_prefix !== prefix) {
        return false;
      }
      if (entityId === null || span.entity_id === null) {
        return true;
      }
      return span.entity_id === entityId;
    });

    if (idx === -1) {
      result.set(event.event_id, null);
      continue;
    }
    const [span] = remaining.splice(idx, 1);
    result.set(event.event_id, span ?? null);
  }

  return result;
}

/** Producer/service label — mirrors the console's other trace views. */
function serviceOf(event: ITrackedEvent): string {
  return event.producer || event.subject.split(".")[2] || "—";
}

/** Row label: for `action_started`/`action_completed` events, prefer the
 * action NAME (e.g. "getPost") over the generic kind — a run has many
 * action rows, and "action_started" repeated for each is useless. Falls
 * back to `kind ?? subject` when the event isn't an action event, or is an
 * action event with no captured name. Started vs completed stays
 * distinguishable via the row's bar/diamond geometry and ordering, not the
 * label text. */
function labelOf(event: ITrackedEvent): string {
  const isActionEvent =
    event.kind === "action_started" || event.kind === "action_completed";
  if (isActionEvent && event.payload_action_name) {
    return event.payload_action_name;
  }
  return event.kind ?? event.subject;
}

/**
 * Builds the waterfall's grid rows: time-axis offsets and bar/diamond
 * geometry (as percentages of the chain's total duration), indented by
 * `causation_depth`, colored by `business_fn` group.
 */
export function computeWaterfallRows(
  chain: ITrackingChainResponse
): readonly IWaterfallRow[] {
  const firstAt = chain.summary.first_at
    ? new Date(chain.summary.first_at).getTime()
    : 0;
  const totalMs = chain.summary.total_ms > 0 ? chain.summary.total_ms : 1;
  const spanByEvent = matchEventSpans(chain.events, chain.spans);

  return chain.events.map((event) => {
    const span = spanByEvent.get(event.event_id) ?? null;
    const occurredMs = new Date(event.occurred_at).getTime();
    const startMs = Math.max(0, occurredMs - firstAt);
    const durationMs = span?.duration_ms ?? 0;
    const isPoint = durationMs <= 0;

    return {
      eventId: event.event_id,
      label: labelOf(event),
      service: serviceOf(event),
      depth: event.causation_depth ?? 0,
      group: businessFnGroup(event.business_fn),
      startMs,
      durationMs,
      isPoint,
      startPercent: (startMs / totalMs) * 100,
      widthPercent: (durationMs / totalMs) * 100,
    };
  });
}

/** Longest span in the chain, and its share of the total chain duration. */
export function computeBottleneck(
  chain: ITrackingChainResponse
): IWaterfallBottleneck | null {
  const rows = computeWaterfallRows(chain);
  const totalMs = chain.summary.total_ms > 0 ? chain.summary.total_ms : 1;

  let bottleneck: IWaterfallRow | null = null;
  for (const row of rows) {
    if (!bottleneck || row.durationMs > bottleneck.durationMs) {
      bottleneck = row;
    }
  }
  if (!bottleneck || bottleneck.durationMs <= 0) {
    return null;
  }

  return {
    eventId: bottleneck.eventId,
    label: bottleneck.label,
    durationMs: bottleneck.durationMs,
    percentOfTotal: (bottleneck.durationMs / totalMs) * 100,
  };
}
