import {
  connect,
  type NatsConnection,
  type JetStreamManager,
  type JetStreamClient,
  type Consumer,
  type RetentionPolicy,
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} from "nats";
import type { FactoryProvider } from "@nestjs/common";

export const NATS_CONNECTION = "NATS_CONNECTION";

/**
 * Creates a NestJS `FactoryProvider` that connects to NATS.
 * Reads `NATS_URL` from environment (default: `nats://localhost:4222`).
 */
export function createNatsConnectionProvider(
  name: string,
): FactoryProvider<Promise<NatsConnection>> {
  return {
    provide: NATS_CONNECTION,
    useFactory: async (): Promise<NatsConnection> => {
      const url =
        process.env.NATS_URL ?? "nats://localhost:4222";
      return connect({ servers: url, name });
    },
  };
}

/**
 * Minimal logger surface used by {@link ensureStream} to report
 * idempotent stream-config reconciliation. Kept duck-typed so callers
 * can plug in `console`, `PinoLoggerService`, or any NestJS logger
 * without an extra dependency.
 */
export interface IEnsureStreamLogger {
  warn?(message: string): void;
  log?(message: string): void;
}

export interface EnsureStreamOptions {
  name: string;
  subjects: readonly string[];
  maxAge?: number;
  maxBytes?: number;
  retention?: RetentionPolicy;
  /**
   * Optional logger used to surface subject-drift reconciliations.
   * When omitted, `console.warn` is used so startup drift is always
   * visible in stdout.
   */
  logger?: IEnsureStreamLogger;
}

/**
 * O(n) set-equality over stream subjects using a Map keyed by subject
 * string. Returns `true` when `current` and `desired` hold the same
 * subjects (regardless of order), `false` otherwise.
 *
 * Using a Map keeps the lookup amortized O(1) per element and avoids
 * the quadratic cost of `Array.includes` over long subject lists
 * (matters for streams that carry wide `filter_subjects` arrays).
 */
function subjectsEqual(
  current: readonly string[] | undefined,
  desired: readonly string[],
): boolean {
  const currentLength = current?.length ?? 0;
  if (currentLength !== desired.length) return false;
  if (currentLength === 0) return true;

  const seen = new Map<string, number>();
  for (let i = 0; i < currentLength; i++) {
    const key = current![i]!;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < desired.length; i++) {
    const key = desired[i]!;
    const count = seen.get(key);
    if (count === undefined) return false;
    if (count === 1) seen.delete(key);
    else seen.set(key, count - 1);
  }
  return seen.size === 0;
}

/**
 * Ensures a JetStream stream exists. Creates it if missing, and
 * idempotently reconciles `subjects`, `maxAge` and `maxBytes` when
 * the stream already exists and its config drifted.
 *
 * Subject drift is treated as an expected outcome of narrowing (or
 * extending) a stream's declared subjects across releases — e.g. the
 * global `DLQ` stream transitioning from `dlq.>` to `dlq.webhook` so
 * the `dlq.<tenant>.>` namespace can host per-tenant DLQ streams
 * without JetStream subject overlap. The update is still rejected by
 * the server if narrowing would orphan subjects owned by another
 * stream, so the operation remains safe.
 *
 * `retention` is intentionally only honoured on creation — mutating
 * retention on an existing stream can truncate live data.
 */
export async function ensureStream(
  jsm: JetStreamManager,
  options: EnsureStreamOptions,
): Promise<void> {
  const { name, subjects, maxAge, maxBytes, retention, logger } =
    options;
  try {
    const info = await jsm.streams.info(name);
    const cfg = info.config;

    const subjectsDrifted = !subjectsEqual(cfg.subjects, subjects);
    const needsUpdate =
      subjectsDrifted ||
      (maxAge !== undefined && cfg.max_age !== maxAge) ||
      (maxBytes !== undefined && cfg.max_bytes !== maxBytes);

    if (needsUpdate) {
      if (subjectsDrifted) {
        const warn = logger?.warn ?? console.warn.bind(console);
        warn(
          `ensureStream: reconciling '${name}' subjects ` +
            `[${(cfg.subjects ?? []).join(",")}] -> [${subjects.join(",")}]`,
        );
      }
      await jsm.streams.update(name, {
        ...cfg,
        ...(subjectsDrifted ? { subjects: [...subjects] } : {}),
        ...(maxAge !== undefined ? { max_age: maxAge } : {}),
        ...(maxBytes !== undefined
          ? { max_bytes: maxBytes }
          : {}),
      });
    }
  } catch {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      ...(maxAge !== undefined ? { max_age: maxAge } : {}),
      ...(maxBytes !== undefined
        ? { max_bytes: maxBytes }
        : {}),
      ...(retention !== undefined ? { retention } : {}),
    });
  }
}

export interface EnsureConsumerOptions {
  stream: string;
  durableName: string;
  filterSubject?: string;
  filterSubjects?: readonly string[];
  maxDeliver?: number;
}

/**
 * Ensures a durable JetStream consumer exists on the given stream.
 * No-op if the consumer already exists.
 */
export async function ensureConsumer(
  jsm: JetStreamManager,
  options: EnsureConsumerOptions,
): Promise<void> {
  const {
    stream,
    durableName,
    filterSubject,
    filterSubjects,
    maxDeliver = 5,
  } = options;
  try {
    await jsm.consumers.add(stream, {
      durable_name: durableName,
      deliver_policy: DeliverPolicy.All,
      ack_policy: AckPolicy.Explicit,
      replay_policy: ReplayPolicy.Instant,
      max_deliver: maxDeliver,
      ...(filterSubject ? { filter_subject: filterSubject } : {}),
      ...(filterSubjects
        ? { filter_subjects: [...filterSubjects] }
        : {}),
    });
  } catch {
    // consumer already exists
  }
}

/**
 * Bootstrap options for JetStream manager: ensure streams and consumers in order.
 */
export interface IJetStreamManagerBootstrapOptions {
  readonly streams: readonly EnsureStreamOptions[];
  readonly consumers: readonly EnsureConsumerOptions[];
}

/**
 * Nest factory: connects JetStream manager, ensures configured streams/consumers.
 */
export function createJetStreamManagerProvider(
  provideToken: string,
  options: IJetStreamManagerBootstrapOptions,
): FactoryProvider<Promise<JetStreamManager>> {
  return {
    provide: provideToken,
    inject: [NATS_CONNECTION],
    useFactory: async (nc: NatsConnection): Promise<JetStreamManager> => {
      const jsm = await nc.jetstreamManager();
      const { streams, consumers } = options;
      for (let i = 0; i < streams.length; i++) {
        await ensureStream(jsm, streams[i]!);
      }
      for (let i = 0; i < consumers.length; i++) {
        await ensureConsumer(jsm, consumers[i]!);
      }
      return jsm;
    },
  };
}

export interface IJetStreamDurableConsumerProviderOptions {
  readonly provide: string;
  readonly managerToken: string;
  readonly streamName: string;
  readonly durableName: string;
}

/**
 * Nest factory: resolves a durable JetStream consumer handle.
 */
export function createJetStreamDurableConsumerProvider(
  opts: IJetStreamDurableConsumerProviderOptions,
): FactoryProvider<Promise<Consumer>> {
  return {
    provide: opts.provide,
    inject: [NATS_CONNECTION, opts.managerToken],
    useFactory: async (
      nc: NatsConnection,
      _jm: JetStreamManager,
    ): Promise<Consumer> => {
      const js: JetStreamClient = nc.jetstream();
      return js.consumers.get(opts.streamName, opts.durableName);
    },
  };
}

export interface IJetStreamPublisherProviderOptions {
  readonly provide: string;
  readonly managerToken: string;
}

/**
 * Nest factory: JetStream client for publishing.
 */
export function createJetStreamPublisherProvider(
  opts: IJetStreamPublisherProviderOptions,
): FactoryProvider<JetStreamClient> {
  return {
    provide: opts.provide,
    inject: [NATS_CONNECTION, opts.managerToken],
    useFactory: (nc: NatsConnection, _jm: JetStreamManager): JetStreamClient =>
      nc.jetstream(),
  };
}
