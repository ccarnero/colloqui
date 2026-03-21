import { Inject, Injectable } from '@nestjs/common';
import type { JetStreamClient, NatsConnection, Subscription } from 'nats';
import { headers as natsHeaders } from 'nats';
import type Redis from 'ioredis';
import { Observable, filter } from 'rxjs';
import {
  SUBJECT_PREFIX,
  RESULT_KEY_PREFIX,
  PENDING_KEY_PREFIX,
  CALLBACK_KEY_PREFIX,
  PENDING_TTL,
  CALLBACK_TTL,
  RESULT_CACHE_MAX,
  TENANT_HEADER,
} from '@yoizen/shared';
import type { EventEnvelope } from '@yoizen/shared';
import { JETSTREAM, NATS_CONNECTION } from '../../providers/nats.provider';
import { REDIS_CLIENT } from '../../providers/redis.provider';
import { randomUUID } from 'crypto';

export interface SseEvent {
  data: string | object;
  id?: string;
  type?: string;
}

@Injectable()
export class EventsService {
  private readonly resultCache = new Map<string, object>();
  private readonly encoder = new TextEncoder();

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async publish(
    type: string,
    payload: Record<string, unknown>,
    tenantId: string,
    callbackUrl?: string,
    enrichAdapter?: { adapterId: string; endpointId: string },
    forwardAdapter?: { adapterId: string; endpointId: string },
    adapterId?: string,
  ): Promise<string> {
    const id = randomUUID();
    const subject = `${SUBJECT_PREFIX}.${type}`;
    const metadata = {
      correlationId: id,
      source: subject,
      receivedAt: Date.now(),
      tenantId,
    };
    const envelope: EventEnvelope = {
      id,
      type,
      payload,
      metadata,
      callbackUrl,
      adapterId,
      enrichAdapter,
      forwardAdapter,
    };
    const body = JSON.stringify(envelope);

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);

    const pipeline = this.redis.pipeline();
    pipeline.setex(
      `${tenantId}:${PENDING_KEY_PREFIX}${id}`,
      PENDING_TTL,
      JSON.stringify({ id, status: 'pending' }),
    );
    if (callbackUrl) {
      pipeline.setex(`${tenantId}:${CALLBACK_KEY_PREFIX}${id}`, CALLBACK_TTL, callbackUrl);
    }

    await Promise.all([
      this.js.publish(subject, this.encoder.encode(body), { headers: hdrs }),
      pipeline.exec(),
    ]);

    return id;
  }

  async getResult(id: string, tenantId: string): Promise<object | null> {
    const cacheKey = `${tenantId}:${id}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const key = `${tenantId}:${RESULT_KEY_PREFIX}${id}`;
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as object;

    if (this.resultCache.size >= RESULT_CACHE_MAX) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey !== undefined) this.resultCache.delete(firstKey);
    }
    this.resultCache.set(cacheKey, parsed);

    return parsed;
  }

  streamEvents(types: string[], tenantId: string): Observable<SseEvent> {
    return new Observable<SseEvent>((subscriber) => {
      const subjects =
        types.length === 0
          ? [`${SUBJECT_PREFIX}.>`]
          : types.map((t) => `${SUBJECT_PREFIX}.${t}`);

      const subs: Subscription[] = [];

      for (const subject of subjects) {
        const sub = this.nc.subscribe(subject);
        subs.push(sub);

        (async () => {
          for await (const msg of sub) {
            try {
              const data = msg.json() as EventEnvelope;
              if (data.metadata?.tenantId !== tenantId) continue;
              subscriber.next({
                data,
                type: msg.subject,
              });
            } catch {
              // skip malformed messages
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
