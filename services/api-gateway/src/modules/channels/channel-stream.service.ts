import { Inject, Injectable } from "@nestjs/common";
import type { NatsConnection } from "nats";
import type { Observable } from "rxjs";
import type { ChannelEnvelope, MessageKind } from "@yoizen/shared";
import {
  CHANNEL_SUBJECT_PREFIX,
  CHANNEL_DOMAIN,
  buildTenantWildcard,
} from "@yoizen/shared";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import type { ISseEvent } from "../../constants";
import { createNatsMultiSubjectObservable } from "../../utils/nats-stream-observable.util";

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
  ): Observable<ISseEvent> {
    const subjects =
      kinds.length === 0
        ? [buildTenantWildcard(tenantId)]
        : kinds.map(
            (kind) =>
              `${CHANNEL_SUBJECT_PREFIX}.${tenantId}.${CHANNEL_DOMAIN}.*.meta.${kind}.v1`,
          );

    return createNatsMultiSubjectObservable(this.nc, subjects, (msg) => {
      const envelope = msg.json() as ChannelEnvelope;
      if (envelope.tenantId !== tenantId) return null;
      return { data: envelope, type: msg.subject };
    });
  }
}
