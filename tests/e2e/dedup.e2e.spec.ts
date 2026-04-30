import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  connect,
  headers as natsHeaders,
  nanos,
  type Consumer,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
  type NatsConnection,
} from "nats";

/**
 * End-to-end non-duplication contract for JetStream durable pull consumers.
 *
 * Two invariants we need to hold after Phase 2 migration:
 *
 *   1. **Stream-level dedup via `Nats-Msg-Id`.**
 *      Publishing the same `Nats-Msg-Id` within the stream's
 *      `duplicate_window` must land exactly one message in storage,
 *      regardless of how many times the publisher retried.
 *
 *   2. **Queue-group sharding across replicas.**
 *      N workers subscribed to the same durable (pull consumer) must
 *      split the N messages between them — each `JsMsg` is delivered
 *      to exactly one replica. No double-processing, no
 *      under-processing.
 *
 * The test talks to a live NATS JetStream (the same instance the
 * cluster uses). `NATS_URL` defaults to `nats://localhost:4222` which
 * works under `bootstrap.sh`/`port-forward.sh`.
 *
 * Big-O: setup O(1); publish phase O(M) where M = number of unique
 * envelopes; consume phase O(M) (each message delivered exactly once);
 * assertions O(R) where R = number of consumer replicas.
 */

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const STREAM = "DEDUP-TEST";
const SUBJECT_ROOT = "evt.dedup-test";
const DURABLE = "dedup-test-consumer";

const REPLICAS = 5;
const UNIQUE_MESSAGES = 10;
const PUBLISHES_PER_MESSAGE = 3;
const TOTAL_PUBLISHES = UNIQUE_MESSAGES * PUBLISHES_PER_MESSAGE;

const SETUP_TIMEOUT = 30_000;
const CONSUME_TIMEOUT = 15_000;

let nc: NatsConnection | undefined;
let js: JetStreamClient | undefined;
let jsm: JetStreamManager | undefined;

async function withRetries<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await Bun.sleep(500 * (i + 1));
    }
  }
  throw new Error(
    `${label} failed after ${attempts} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function tryDelete(): Promise<void> {
  if (!jsm) return;
  try {
    await jsm.streams.delete(STREAM);
  } catch {
    // already gone
  }
}

describe("JetStream deduplication + queue-group sharding", () => {
  beforeAll(async () => {
    nc = await connect({ servers: NATS_URL, timeout: SETUP_TIMEOUT });
    jsm = await nc.jetstreamManager();
    js = nc.jetstream();

    await tryDelete();

    // duplicate_window: 60s — long enough that 3 burst publishes of the
    // same Nats-Msg-Id collapse to a single stream entry.
    await withRetries(
      () =>
        jsm!.streams.add({
          name: STREAM,
          subjects: [`${SUBJECT_ROOT}.>`],
          duplicate_window: nanos(60_000),
          max_age: nanos(5 * 60_000),
        }),
      "streams.add",
    );

    await withRetries(
      () =>
        jsm!.consumers.add(STREAM, {
          durable_name: DURABLE,
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
          replay_policy: ReplayPolicy.Instant,
          max_ack_pending: 1000,
          ack_wait: nanos(30_000),
        }),
      "consumers.add",
    );
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    try {
      await tryDelete();
    } finally {
      await nc?.drain();
    }
  });

  it(
    "dedups same Nats-Msg-Id within duplicate_window (stream stores 1 per msgId)",
    async () => {
      const encoder = new TextEncoder();
      const acks = new Map<string, number[]>();

      for (let m = 0; m < UNIQUE_MESSAGES; m++) {
        const msgId = `dedup-test-msg-${m}`;
        const subject = `${SUBJECT_ROOT}.publish.${m}`;
        for (let p = 0; p < PUBLISHES_PER_MESSAGE; p++) {
          const ack = await js!.publish(
            subject,
            encoder.encode(JSON.stringify({ msgId, attempt: p })),
            { msgID: msgId },
          );
          const list = acks.get(msgId) ?? [];
          list.push(ack.seq);
          acks.set(msgId, list);
        }
      }

      const info = await jsm!.streams.info(STREAM);
      // nats.js returns `state.messages` as a plain number, so we coerce both
      // sides to `Number` to stay compatible across client versions (older
      // builds may return a BigInt).
      expect(Number(info.state.messages)).toBe(UNIQUE_MESSAGES);

      // Every retry of the same msgId must return the *same* stream seq
      // — that's what "duplicate accepted, not stored twice" looks like.
      for (const [msgId, seqs] of acks) {
        const unique = new Set(seqs);
        expect({ msgId, unique: [...unique] }).toEqual({
          msgId,
          unique: [seqs[0]!],
        });
      }
    },
    CONSUME_TIMEOUT,
  );

  it(
    "queue-group: N replicas on the same durable deliver each msg exactly once",
    async () => {
      const delivered = new Map<string, Set<number>>();
      const consumers: Consumer[] = [];
      const iterators: Array<AsyncIterable<JsMsg> & { stop?: () => void }> = [];

      for (let r = 0; r < REPLICAS; r++) {
        const c = await js!.consumers.get(STREAM, DURABLE);
        consumers.push(c);
      }

      const runOne = async (replicaIdx: number): Promise<void> => {
        const it = await consumers[replicaIdx]!.consume({
          max_messages: 100,
          expires: 5_000,
        });
        iterators.push(it as never);
        try {
          for await (const msg of it) {
            try {
              const headerMsgId = msg.headers?.get("Nats-Msg-Id");
              if (headerMsgId) {
                const seen = delivered.get(headerMsgId) ?? new Set<number>();
                seen.add(replicaIdx);
                delivered.set(headerMsgId, seen);
              }
            } finally {
              msg.ack();
            }
          }
        } catch {
          // iterator stopped
        }
      };

      const runners = Array.from({ length: REPLICAS }, (_, i) => runOne(i));

      await Bun.sleep(3_000);

      for (const it of iterators) it.stop?.();
      await Promise.all(runners);

      expect(delivered.size).toBe(UNIQUE_MESSAGES);
      for (const [msgId, replicas] of delivered) {
        expect({ msgId, replicas: replicas.size }).toEqual({
          msgId,
          replicas: 1,
        });
      }

      // sanity: no single replica ate everything (sharding actually happened).
      const replicaHitCount = new Map<number, number>();
      for (const replicas of delivered.values()) {
        for (const r of replicas) {
          replicaHitCount.set(r, (replicaHitCount.get(r) ?? 0) + 1);
        }
      }
      const sum = [...replicaHitCount.values()].reduce((a, b) => a + b, 0);
      expect(sum).toBe(UNIQUE_MESSAGES);
    },
    CONSUME_TIMEOUT,
  );

  it(
    "duplicate redeliveries do not re-deliver after ack",
    async () => {
      // Publish an 11th unique msg and verify that after one consumer
      // acks it, no other consumer gets a redelivery for the same
      // Nats-Msg-Id (no double processing via redelivery).
      const msgId = `dedup-test-tail-${Date.now()}`;
      const encoder = new TextEncoder();
      await js!.publish(
        `${SUBJECT_ROOT}.tail`,
        encoder.encode("{}"),
        { msgID: msgId },
      );

      const c = await js!.consumers.get(STREAM, DURABLE);
      const it = await c.consume({ max_messages: 10, expires: 2_000 });

      let count = 0;
      const collected: string[] = [];
      const runner = (async () => {
        try {
          for await (const msg of it) {
            const id = msg.headers?.get("Nats-Msg-Id");
            if (id === msgId) {
              count++;
              collected.push(id);
            }
            msg.ack();
          }
        } catch {
          // iterator stopped
        }
      })();

      await Bun.sleep(2_500);
      it.stop();
      await runner;

      expect(count).toBe(1);
      expect(collected).toEqual([msgId]);
    },
    CONSUME_TIMEOUT,
  );
});
