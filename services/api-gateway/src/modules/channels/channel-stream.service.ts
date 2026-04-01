import { Inject, Injectable } from "@nestjs/common";
import type { NatsConnection, Subscription } from "nats";
import { Observable } from "rxjs";
import type { ChannelEnvelope, MessageKind } from "@yoizen/shared";
import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_DOMAIN,
  buildTenantWildcard,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";

interface SseEvent {
  data: string | object;
  id?: string;
  type?: string;
}

@Injectable()
export class ChannelStreamService {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  /**
   * Subscribes to channel messaging NATS subjects for the given tenant
   * and emits ChannelEnvelope payloads as SSE events.
   *
   * @param tenantId - Tenant to scope the subscription to
   * @param kinds - Optional list of message kinds (received, sent, etc.)
   */
  streamChannelEvents(
    tenantId: string,
    kinds: MessageKind[] = [],
  ): Observable<SseEvent> {
    return new Observable<SseEvent>((subscriber) => {
      const subjects =
        kinds.length === 0
          ? [buildTenantWildcard(tenantId)]
          : kinds.map(
              (kind) =>
                `${CHANNEL_SUBJECT_PREFIX}.${tenantId}.${CHANNEL_DOMAIN}.*.meta.${kind}.v1`,
            );

      const subs: Subscription[] = [];

      for (const subject of subjects) {
        const sub = this.nc.subscribe(subject);
        subs.push(sub);

        (async () => {
          for await (const msg of sub) {
            try {
              const envelope = msg.json() as ChannelEnvelope;
              if (envelope.tenantId !== tenantId) continue;
              subscriber.next({ data: envelope, type: msg.subject });
            } catch {
              /* skip malformed messages */
            }
          }
        })();
      }

      return () => {
        for (const sub of subs) {
          sub.unsubscribe();
        }
      };
    });
  }
}
