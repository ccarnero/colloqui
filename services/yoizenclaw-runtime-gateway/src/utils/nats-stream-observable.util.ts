import type { NatsConnection } from "nats";
import { Observable } from "rxjs";

export function createNatsMultiSubjectObservable<T>(
  nc: NatsConnection,
  subjects: string[],
  mapper: (msg: { subject: string; json: () => unknown }) => T | null,
): Observable<T> {
  return new Observable<T>((subscriber) => {
    const subscriptions = subjects.map((subject) =>
      nc.subscribe(subject, {
        callback: (_error, msg) => {
          const mapped = mapper({
            subject: msg.subject,
            json: () => msg.json(),
          });
          if (mapped !== null) {
            subscriber.next(mapped);
          }
        },
      }),
    );

    return () => {
      for (let i = 0; i < subscriptions.length; i++) {
        subscriptions[i]?.unsubscribe();
      }
    };
  });
}
