import "reflect-metadata";
import { describe, it, expect, mock } from "bun:test";
import { createNatsMultiSubjectObservable } from "../../src/utils/nats-stream-observable.util";

describe("createNatsMultiSubjectObservable", () => {
  it("calls unsubscribe on each subscription when observer completes", () => {
    const unsub = mock(() => {});
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        /* empty */
      },
    };
    const mockSub = { ...asyncIterable, unsubscribe: unsub };
    const nc = {
      subscribe: mock(() => mockSub),
    };

    const obs = createNatsMultiSubjectObservable(nc as never, ["events.>"], () => null);
    const subscription = obs.subscribe({});
    subscription.unsubscribe();

    expect(unsub).toHaveBeenCalled();
  });
});
