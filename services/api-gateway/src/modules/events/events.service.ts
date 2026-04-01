import { Inject, Injectable } from '@nestjs/common';
import type { JetStreamClient, NatsConnection, Subscription } from 'nats';
import { headers as natsHeaders } from 'nats';
import type Redis from 'ioredis';
import { Observable } from 'rxjs';
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
import { randomUUID, createHash } from 'crypto';

interface SseEvent {
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
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
    const payloadChecksum = createHash("sha256")
      .update(payloadJson)
      .digest("hex");

    const envelope: EventEnvelope = {
      specversion: "1.0",
      id,
      source: subject,
      type,
      resource: type,
      time: now,
      traceid: id,
      causation_id: null,
      correlation_id: id,
      tenant: tenantId,
      producer: "api-gateway",
      domain: "platform",
      channel: "events",
      provider: "gateway",
      accountid: tenantId,
      idempotencykey: id,
      transport: { method: "stream", protocol: "internal" },
      data: {
        received_at: now,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: payloadBytes,
        payload_checksum: payloadChecksum,
        payload,
      },
      ...(callbackUrl && { callback_url: callbackUrl }),
      ...(adapterId && { adapter_id: adapterId }),
      ...(enrichAdapter && { enrich_adapter: enrichAdapter }),
      ...(forwardAdapter && { forward_adapter: forwardAdapter }),
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
              if (data.tenant !== tenantId) continue;
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
