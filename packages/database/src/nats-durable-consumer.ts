import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  nanos,
  type Consumer,
  type JetStreamClient,
  type JetStreamManager,
} from "nats";

const DEFAULT_MAX_DELIVER = 5;
const DEFAULT_MAX_ACK_PENDING = 1000;
const DEFAULT_ACK_WAIT_MS = 30_000;
const DEFAULT_BACKOFF_MS: readonly number[] = [
  1_000,
  5_000,
  30_000,
  120_000,
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
  /** Time before redelivery of an unacked message (ms). @default 30_000 */
  readonly ackWaitMs?: number;
  /** Backoff schedule for redeliveries (ms). @default [1s, 5s, 30s, 2m] */
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
 * The function caches successful ensures in an in-memory `Map` so that
 * subsequent calls for the same `(stream, durableName)` are O(1).
 *
 * @returns `void` when the consumer exists (created or pre-existing).
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

  try {
    await jsm.consumers.info(options.stream, options.durableName);
    ensuredConsumers.set(key, true);
    return;
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

  await jsm.consumers.add(options.stream, {
    durable_name: options.durableName,
    deliver_policy: DeliverPolicy.All,
    ack_policy: AckPolicy.Explicit,
    replay_policy: ReplayPolicy.Instant,
    max_deliver: maxDeliver,
    max_ack_pending: maxAckPending,
    ack_wait: nanos(ackWaitMs),
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
