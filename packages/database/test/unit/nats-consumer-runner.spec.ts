import "reflect-metadata";
import { describe, it, expect, mock } from "bun:test";
import type { Consumer, JsMsg } from "nats";
import { NatsConsumerRunner } from "../../src/nats-consumer-runner";
import { PermanentError } from "@yoizen/shared";

/**
 * Bun.sleep is available but jittery under load; prefer explicit
 * resolvers so we can synchronously advance scenarios.
 */
interface IDeferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function defer<T>(): IDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Test double for a JsMsg. Tracks ack/nak/term calls so assertions can
 * verify the runner's protocol without pulling a real NATS connection.
 */
interface IFakeMsg {
  readonly msg: JsMsg;
  readonly id: number;
  readonly acks: { count: number };
  readonly naks: { count: number };
  readonly terms: { count: number };
}

function makeFakeMsg(id: number): IFakeMsg {
  const acks = { count: 0 };
  const naks = { count: 0 };
  const terms = { count: 0 };
  const msg = {
    subject: `test.${id}`,
    data: new Uint8Array(),
    ack: () => {
      acks.count++;
    },
    nak: () => {
      naks.count++;
    },
    term: () => {
      terms.count++;
    },
    seq: id,
    info: { deliveryCount: 1 },
    headers: undefined,
  } as unknown as JsMsg;
  return { msg, id, acks, naks, terms };
}

/**
 * Minimal async iterable that yields the provided messages in order.
 * Exposes a `stop()` method to match the real `ConsumerMessages`
 * interface expected by the runner.
 */
function makeIterator(msgs: IFakeMsg[]): {
  iter: AsyncIterable<JsMsg> & { stop: () => void };
  stopped: { called: boolean };
} {
  const stopped = { called: false };
  let i = 0;
  const iter: AsyncIterable<JsMsg> & { stop: () => void } = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (stopped.called || i >= msgs.length) {
            return { value: undefined as unknown as JsMsg, done: true };
          }
          return { value: msgs[i++]!.msg, done: false };
        },
      };
    },
    stop: () => {
      stopped.called = true;
    },
  };
  return { iter, stopped };
}

function makeConsumer(
  iter: AsyncIterable<JsMsg> & { stop: () => void },
): Consumer {
  return {
    consume: async () => iter,
  } as unknown as Consumer;
}

const noopLogger = {
  error: mock((_: string) => undefined),
  warn: mock((_: string) => undefined),
};

describe("NatsConsumerRunner", () => {
  describe("serial mode (default / concurrency=1)", () => {
    it("ack's successful handlers and preserves serial order", async () => {
      const msgs = [makeFakeMsg(1), makeFakeMsg(2), makeFakeMsg(3)];
      const { iter } = makeIterator(msgs);
      const order: number[] = [];
      const handler = async (m: JsMsg) => {
        order.push((m as unknown as { seq: number }).seq);
      };

      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        handler,
        noopLogger,
      );
      await runner.start();
      await Bun.sleep(20); // let the `run` task drain

      expect(order).toEqual([1, 2, 3]);
      expect(msgs.every((m) => m.acks.count === 1)).toBe(true);
      expect(msgs.every((m) => m.naks.count === 0)).toBe(true);
    });

    it("nak's handlers that throw a transient error", async () => {
      const m = makeFakeMsg(1);
      const { iter } = makeIterator([m]);
      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        async () => {
          throw new Error("boom");
        },
        noopLogger,
      );
      await runner.start();
      await Bun.sleep(10);

      expect(m.acks.count).toBe(0);
      expect(m.naks.count).toBe(1);
      expect(m.terms.count).toBe(0);
    });

    it("term's handlers that throw PermanentError and invokes onPermanent", async () => {
      const m = makeFakeMsg(1);
      const { iter } = makeIterator([m]);
      const onPermanent = mock(async () => undefined);
      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        async () => {
          throw new PermanentError("bad-shape", "validation");
        },
        noopLogger,
        undefined,
        { onPermanent },
      );
      await runner.start();
      await Bun.sleep(10);

      expect(m.acks.count).toBe(0);
      expect(m.naks.count).toBe(0);
      expect(m.terms.count).toBe(1);
      expect(onPermanent).toHaveBeenCalledTimes(1);
    });
  });

  describe("concurrent mode (concurrency>1)", () => {
    it("runs up to N handlers in parallel (no head-of-line blocking)", async () => {
      const msgs = Array.from({ length: 10 }, (_, i) => makeFakeMsg(i + 1));
      const { iter } = makeIterator(msgs);
      const gates = msgs.map(() => defer<void>());
      let maxInFlight = 0;
      let inFlight = 0;

      const handler = async (m: JsMsg): Promise<void> => {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        const seq = (m as unknown as { seq: number }).seq;
        await gates[seq - 1]!.promise;
        inFlight--;
      };

      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        handler,
        noopLogger,
        { concurrency: 4 },
      );
      await runner.start();
      await Bun.sleep(20); // give the runner time to saturate the slot window

      // With concurrency=4 and blocking gates, at most 4 should be in flight.
      expect(maxInFlight).toBe(4);

      // Releasing gates in reverse order — valid out-of-order completion.
      for (let i = msgs.length - 1; i >= 0; i--) {
        gates[i]!.resolve();
      }
      await Bun.sleep(30);

      expect(msgs.every((m) => m.acks.count === 1)).toBe(true);
      expect(msgs.every((m) => m.naks.count === 0)).toBe(true);
    });

    it("tolerates out-of-order handler completion and acks every message once", async () => {
      const msgs = [makeFakeMsg(1), makeFakeMsg(2), makeFakeMsg(3)];
      const { iter } = makeIterator(msgs);
      const gates = msgs.map(() => defer<void>());

      const handler = async (m: JsMsg): Promise<void> => {
        const seq = (m as unknown as { seq: number }).seq;
        await gates[seq - 1]!.promise;
      };

      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        handler,
        noopLogger,
        { concurrency: 8 },
      );
      await runner.start();
      await Bun.sleep(10);

      // Resolve in reverse order: 3 → 1 → 2
      gates[2]!.resolve();
      await Bun.sleep(5);
      gates[0]!.resolve();
      await Bun.sleep(5);
      gates[1]!.resolve();
      await Bun.sleep(10);

      expect(msgs.map((m) => m.acks.count)).toEqual([1, 1, 1]);
    });

    it("bounded concurrency — handler slower than pull rate does not explode inflight", async () => {
      const msgs = Array.from({ length: 50 }, (_, i) => makeFakeMsg(i + 1));
      const { iter } = makeIterator(msgs);
      let inFlight = 0;
      let maxInFlight = 0;

      const handler = async (): Promise<void> => {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await Bun.sleep(2);
        inFlight--;
      };

      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        handler,
        noopLogger,
        { concurrency: 5 },
      );
      await runner.start();
      await Bun.sleep(200); // all 50 should drain

      expect(maxInFlight).toBeLessThanOrEqual(5);
      expect(msgs.every((m) => m.acks.count === 1)).toBe(true);
    });

    it("one failing handler does not block other messages", async () => {
      const msgs = [makeFakeMsg(1), makeFakeMsg(2), makeFakeMsg(3)];
      const { iter } = makeIterator(msgs);
      const handler = async (m: JsMsg): Promise<void> => {
        const seq = (m as unknown as { seq: number }).seq;
        if (seq === 2) throw new Error("only #2 fails");
      };
      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        handler,
        noopLogger,
        { concurrency: 4 },
      );
      await runner.start();
      await Bun.sleep(20);

      expect(msgs[0]!.acks.count).toBe(1);
      expect(msgs[1]!.naks.count).toBe(1);
      expect(msgs[2]!.acks.count).toBe(1);
    });
  });

  describe("stop()", () => {
    it("stops the iterator and releases the run loop", async () => {
      const msgs = [makeFakeMsg(1)];
      const { iter, stopped } = makeIterator(msgs);
      const runner = new NatsConsumerRunner(
        makeConsumer(iter),
        async () => undefined,
        noopLogger,
      );
      await runner.start();
      await Bun.sleep(5);
      await runner.stop();
      expect(stopped.called).toBe(true);
    });
  });
});
