import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  nanos,
  type Consumer,
  type ConsumerInfo,
  type JetStreamClient,
  type JetStreamManager,
} from "nats";

const DEFAULT_MAX_DELIVER = 5;
const DEFAULT_MAX_ACK_PENDING = 1000;
/**
 * Time the server waits for an ack before redelivering. Must exceed the
 * worst-case handler runtime by a comfortable margin. Handlers that do
 * HTTP to third parties (Telegram, connector endpoints) can take seconds under
 * cold-start / TLS handshake / event-loop saturation — 60s leaves 6x
 * headroom over the 10s external HTTP timeout.
 *
 * HISTORICAL NOTE: a prior value of 1_000 ms leaked into the platform's
 * `INGRESS-*` durables and caused silent at-least-once duplication of
 * outbound Telegram replies (the handler routinely exceeded 1s, the
 * server NAK'd the in-flight message, and a second replica processed
 * it and sent the reply again). See `ensureDurableConsumer` below —
 * we now `update()` existing durables whose `ack_wait` drifts from the
 * current default so fixes in this file actually propagate to running
 * clusters without a manual migration.
 */
export const DEFAULT_ACK_WAIT_MS = 60_000;
/**
 * NATS server semantics: when a `backoff` array is set on a consumer
 * it OVERRIDES `ack_wait`. The effective ack-wait window for the i-th
 * delivery is `backoff[i-1]` (the last value is reused once exhausted).
 * That means the *first* element doubles as the initial redelivery
 * window — keeping it shorter than the longest-running handler causes
 * silent duplicate deliveries even when ack_wait is set higher.
 *
 * We therefore anchor the first step at `DEFAULT_ACK_WAIT_MS` so the
 * two values stay consistent, and let subsequent retries back off
 * progressively for genuinely failing handlers.
 */
export const DEFAULT_BACKOFF_MS: readonly number[] = [
  60_000,
  120_000,
  300_000,
  600_000,
];

/**
 * Options for {@link ensureDurableConsumer}.
 *
 * Pull consumers auto-shard between multiple clients that call
 * `consume()` on the same `(stream, durableName)` — the NATS server
 * load-balances deliveries automatically. `deliverGroup` is therefore
 * only useful for push consumers (deprecated in nats v2.x) but kept
 * here for forward compatibility.
 */
export interface IDurableConsumerOptions {
  /** JetStream stream name, e.g. `"INGRESS-acme"`. */
  readonly stream: string;
  /** Durable consumer name (acts as shard key for pull consumers). */
  readonly durableName: string;
  /** Subject filter (single-subject). Exclusive with `filterSubjects`. */
  readonly filterSubject?: string;
  /** Subject filter list. Exclusive with `filterSubject`. */
  readonly filterSubjects?: readonly string[];
  /** Queue/deliver group for push consumers. Defaults to `durableName`. */
  readonly deliverGroup?: string;
  /** Maximum deliveries before a message is terminated. @default 5 */
  readonly maxDeliver?: number;
  /** Maximum unacked in-flight messages (backpressure). @default 1000 */
  readonly maxAckPending?: number;
  /** Time before redelivery of an unacked message (ms). @default 60_000 */
  readonly ackWaitMs?: number;
  /** Backoff schedule for redeliveries (ms). @default [60s, 120s, 300s, 600s] */
  readonly backoffMs?: readonly number[];
  /** Optional human-friendly description persisted on the consumer. */
  readonly description?: string;
}

/**
 * Cache of `(stream::durable)` → `true` so that repeated
 * `ensureDurableConsumer` calls in the hot path short-circuit after
 * the first successful ensure. O(1) lookup/insert.
 */
const ensuredConsumers = new Map<string, true>();

function cacheKey(stream: string, durableName: string): string {
  return `${stream}::${durableName}`;
}

function buildBackoffNanos(backoffMs: readonly number[]): number[] {
  const out: number[] = new Array(backoffMs.length);
  for (let i = 0; i < backoffMs.length; i++) {
    out[i] = nanos(backoffMs[i]!);
  }
  return out;
}

/**
 * Idempotently ensures a durable JetStream pull consumer exists with
 * the configuration this platform expects:
 *
 * - `ack_policy: Explicit` — required for at-least-once with ack/nak.
 * - `deliver_policy: All` — start from the beginning of available history.
 * - `replay_policy: Instant` — deliver as fast as the consumer can pull.
 * - `max_deliver` + `backoff` — bounded retries with backoff.
 * - `max_ack_pending` — backpressure cap on in-flight messages.
 * - `ack_wait` — redelivery window if the consumer crashes mid-handler.
 *
 * When the durable already exists on the server, this function does
 * NOT silently skip: it compares the mutable fields (`ack_wait`,
 * `max_deliver`, `max_ack_pending`, `backoff`, `description`) against
 * the desired config and issues `jsm.consumers.update(...)` if they
 * drift. This makes defaults in this file actually reach running
 * clusters without requiring a manual delete/recreate cycle — a must
 * after we shipped a too-low `ack_wait` value that caused silent
 * duplicate processing.
 *
 * Fields that are NOT reconciled (filter subjects, ack/deliver/replay
 * policies, deliver_group) are left as-is — the server rejects changes
 * to those. If one of them drifts the operator must delete and
 * recreate the durable.
 *
 * The function caches successful ensures in an in-memory `Map` so that
 * subsequent calls for the same `(stream, durableName)` are O(1).
 *
 * @returns `void` when the consumer exists (created, reconciled, or
 * already matching).
 */
export async function ensureDurableConsumer(
  jsm: JetStreamManager,
  options: IDurableConsumerOptions,
): Promise<void> {
  const key = cacheKey(options.stream, options.durableName);
  if (ensuredConsumers.has(key)) return;

  const maxDeliver = options.maxDeliver ?? DEFAULT_MAX_DELIVER;
  const maxAckPending = options.maxAckPending ?? DEFAULT_MAX_ACK_PENDING;
  const ackWaitMs = options.ackWaitMs ?? DEFAULT_ACK_WAIT_MS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const deliverGroup = options.deliverGroup ?? options.durableName;
  const ackWaitNanos = nanos(ackWaitMs);

  let existing: ConsumerInfo | null = null;
  try {
    existing = await jsm.consumers.info(options.stream, options.durableName);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      !msg.includes("not found") &&
      !msg.includes("no consumer") &&
      !msg.includes("consumer not found")
    ) {
      throw err;
    }
  }

  if (existing) {
    await reconcileDurableConsumer(jsm, options.stream, options.durableName, {
      existing,
      ackWaitNanos,
      maxDeliver,
      maxAckPending,
      backoffNanos: buildBackoffNanos(backoffMs),
      description: options.description,
    });
    ensuredConsumers.set(key, true);
    return;
  }

  await jsm.consumers.add(options.stream, {
    durable_name: options.durableName,
    deliver_policy: DeliverPolicy.All,
    ack_policy: AckPolicy.Explicit,
    replay_policy: ReplayPolicy.Instant,
    max_deliver: maxDeliver,
    max_ack_pending: maxAckPending,
    ack_wait: ackWaitNanos,
    backoff: buildBackoffNanos(backoffMs),
    deliver_group: deliverGroup,
    ...(options.filterSubject
      ? { filter_subject: options.filterSubject }
      : {}),
    ...(options.filterSubjects
      ? { filter_subjects: [...options.filterSubjects] }
      : {}),
    ...(options.description ? { description: options.description } : {}),
  });

  ensuredConsumers.set(key, true);
}

interface IReconcileOptions {
  readonly existing: ConsumerInfo;
  readonly ackWaitNanos: number;
  readonly maxDeliver: number;
  readonly maxAckPending: number;
  readonly backoffNanos: readonly number[];
  readonly description?: string;
}

/**
 * Issues `jsm.consumers.update(...)` when any mutable field drifts.
 * Kept free of side-effects on the ensure cache — the caller decides
 * when to record success.
 *
 * Server-side invariant (NATS >=2.10): `max_deliver` must be strictly
 * greater than `backoff.length`. The update is sent as a single atomic
 * call so the new `backoff` and `max_deliver` land together and the
 * pair is always self-consistent.
 */
async function reconcileDurableConsumer(
  jsm: JetStreamManager,
  stream: string,
  durableName: string,
  opts: IReconcileOptions,
): Promise<void> {
  const current = opts.existing.config;
  const currentBackoff = current.backoff ?? [];
  const drifted =
    current.ack_wait !== opts.ackWaitNanos ||
    current.max_deliver !== opts.maxDeliver ||
    current.max_ack_pending !== opts.maxAckPending ||
    !nanoArraysEqual(currentBackoff, opts.backoffNanos) ||
    (opts.description !== undefined &&
      current.description !== opts.description);

  if (!drifted) return;

  await jsm.consumers.update(stream, durableName, {
    ack_wait: opts.ackWaitNanos,
    max_deliver: opts.maxDeliver,
    max_ack_pending: opts.maxAckPending,
    backoff: [...opts.backoffNanos],
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
  });
}

function nanoArraysEqual(
  a: readonly number[],
  b: readonly number[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Resolves a `Consumer` handle for an already-ensured durable.
 *
 * Pull consumer semantics: multiple replicas that call this with the
 * same `(stream, durableName)` and then `.consume()` will have the
 * server load-balance messages across them — sharding comes for free.
 *
 * @throws If the consumer does not exist. Call
 * {@link ensureDurableConsumer} first at startup.
 */
export async function getDurableConsumer(
  js: JetStreamClient,
  stream: string,
  durableName: string,
): Promise<Consumer> {
  return js.consumers.get(stream, durableName);
}

/**
 * Test-only helper: clears the in-memory ensure cache so unit tests can
 * assert idempotency semantics without cross-test pollution. Never call
 * from application code.
 *
 * @internal
 */
export function __resetEnsuredConsumerCacheForTests(): void {
  ensuredConsumers.clear();
}
