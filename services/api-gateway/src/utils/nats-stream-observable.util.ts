import type { Msg, NatsConnection, Subscription } from "nats";
import { Observable } from "rxjs";
import type { ISseEvent } from "../constants";

/**
 * Shared core NATS subscribe loop for SSE streams. One subscription per
 * subject; teardown unsubscribes all. O(s) for subject count s.
 *
 * @param mapMessage - Return `null` to skip a message (e.g. tenant mismatch).
 */
export function createNatsMultiSubjectObservable(
  nc: NatsConnection,
  subjects: string[],
  mapMessage: (msg: Msg) => ISseEvent | null,
): Observable<ISseEvent> {
  return new Observable<ISseEvent>((subscriber) => {
    const subs: Subscription[] = [];
    for (const subject of subjects) {
      const sub = nc.subscribe(subject);
      subs.push(sub);
      void (async () => {
        for await (const msg of sub) {
          try {
            const evt = mapMessage(msg);
            if (evt === null) continue;
            subscriber.next(evt);
          } catch {
            // skip malformed messages
          }
        }
      })();
    }
    return () => {
      for (const s of subs) {
        s.unsubscribe();
      }
    };
  });
}
