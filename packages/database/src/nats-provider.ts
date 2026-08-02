import type { FactoryProvider } from "@nestjs/common";
import {
  CHANNEL_STREAM_MAX_AGE_NS,
  CHANNEL_STREAM_MAX_BYTES,
  checkJetStreamCapacity,
  getTenantStreamName,
  getTenantSubjectPattern,
  type TenantStreamLimits,
} from "@yoizen/shared";
import {
  AckPolicy,
  type Consumer,
  connect,
  DeliverPolicy,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  ReplayPolicy,
  RetentionPolicy,
} from "nats";

export const NATS_CONNECTION = "NATS_CONNECTION";

/**
 * Creates a NestJS `FactoryProvider` that connects to NATS.
 * Reads `NATS_URL` from environment (default: `nats://localhost:4222`).
 */
export function createNatsConnectionProvider(
  name: string
): FactoryProvider<Promise<NatsConnection>> {
  return {
    provide: NATS_CONNECTION,
    useFactory: async (): Promise<NatsConnection> => {
      const url = process.env.NATS_URL ?? "nats://localhost:4222";
      return connect({ servers: url, name, waitOnFirstConnect: true });
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
  desired: readonly string[]
): boolean {
  const currentLength = current?.length ?? 0;
  if (currentLength !== desired.length) {
    return false;
  }
  if (currentLength === 0) {
    return true;
  }

  const seen = new Map<string, number>();
  for (let i = 0; i < currentLength; i++) {
    const key = current![i]!;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < desired.length; i++) {
    const key = desired[i]!;
    const count = seen.get(key);
    if (count === undefined) {
      return false;
    }
    if (count === 1) {
      seen.delete(key);
    } else {
      seen.set(key, count - 1);
    }
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
  options: EnsureStreamOptions
): Promise<void> {
  const { name, subjects, maxAge, maxBytes, retention, logger } = options;
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
            `[${(cfg.subjects ?? []).join(",")}] -> [${subjects.join(",")}]`
        );
      }
      await jsm.streams.update(name, {
        ...cfg,
        ...(subjectsDrifted ? { subjects: [...subjects] } : {}),
        ...(maxAge !== undefined ? { max_age: maxAge } : {}),
        ...(maxBytes !== undefined ? { max_bytes: maxBytes } : {}),
      });
    }
  } catch {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      ...(maxAge !== undefined ? { max_age: maxAge } : {}),
      ...(maxBytes !== undefined ? { max_bytes: maxBytes } : {}),
      ...(retention !== undefined ? { retention } : {}),
    });
  }
}

/**
 * NATS JetStream API error code surfaced when `streams.add` is called
 * for a stream name that already exists on the broker. Defined by the
 * server in `nats-server` (`api-errors.json` → `JSStreamNameInUseErr`).
 */
const STREAM_NAME_IN_USE_ERR_CODE = 10058;

/**
 * Substring match used as a fallback when the broker error does not
 * carry a structured `api_error.err_code` (older brokers / wrapped
 * errors). Both checks must agree on the same outcome: treat the
 * stream as already-ensured.
 */
const STREAM_NAME_IN_USE_MESSAGE = "stream name already in use";

/**
 * Module-level O(1) lookup cache of stream names whose existence has
 * already been confirmed on the broker. Keyed by stream name (not
 * tenant id) so the cache is safe to share across tenants in the same
 * pod and stable across `tenantId` casing variations (the upstream
 * `getTenantStreamName` upper-cases the id before composing the
 * stream name).
 *
 * Cache lifetime: the lifetime of the JS module (i.e. the pod).
 */
const ensuredTenantIngressStreams = new Set<string>();

/**
 * In-flight ensure promises keyed by stream name. Used to coalesce
 * concurrent calls for the same tenant into a single `streams.add`
 * round-trip (avoids hammering the JSAPI on cold start when many
 * publishes for a new tenant arrive simultaneously).
 *
 * Entries are removed from this map as soon as the underlying
 * promise settles; successful settlements ALSO seed
 * {@link ensuredTenantIngressStreams} so subsequent calls are
 * synchronous no-ops.
 */
const inFlightTenantIngressEnsures = new Map<string, Promise<void>>();

/**
 * Returns `true` when the broker error indicates the requested stream
 * already exists. Matches the structured `api_error.err_code`
 * (`STREAM_NAME_IN_USE_ERR_CODE`, 10058) when present and falls back
 * to a message substring check for transports that strip the
 * structured payload.
 */
function isStreamNameInUseError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const apiError = (err as { api_error?: { err_code?: unknown } }).api_error;
    if (
      apiError &&
      typeof apiError.err_code === "number" &&
      apiError.err_code === STREAM_NAME_IN_USE_ERR_CODE
    ) {
      return true;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(STREAM_NAME_IN_USE_MESSAGE);
}

const STREAM_NOT_FOUND_ERR_CODE = 10059;
const STREAM_NOT_FOUND_MESSAGE = "stream not found";

/**
 * Returns `true` when the broker error indicates the requested stream does
 * not exist (NATS `JSStreamNotFoundErr`). Mirrors
 * {@link isStreamNameInUseError}: structured `api_error.err_code` (10059)
 * first, message-substring fallback. Callers use it to distinguish a genuine
 * "absent stream" from transport/auth failures, which must propagate —
 * treating a broken connection as "absent" is how state drifts silently
 * (tenant-messaging-tiers T04 review).
 */
export function isStreamNotFoundError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const apiError = (err as { api_error?: { err_code?: unknown } }).api_error;
    if (
      apiError &&
      typeof apiError.err_code === "number" &&
      apiError.err_code === STREAM_NOT_FOUND_ERR_CODE
    ) {
      return true;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(STREAM_NOT_FOUND_MESSAGE);
}

/**
 * Performs the broker round-trip for {@link ensureTenantIngressStream}.
 * Tries `streams.add` directly; if the broker reports the stream
 * already exists (NATS `JSStreamNameInUseErr` / err_code 10058) the
 * call is treated as a successful ensure. Any other error class is
 * rethrown so callers can bubble it up to their retry/metric path.
 */
/**
 * Thrown by {@link ensureTenantIngressStream} when `checkCapacity` is set and
 * the JetStream account cannot fit another stream of the requested size
 * (`options.limits.max_bytes` when tier limits are passed, else the flat
 * `CHANNEL_STREAM_MAX_BYTES`). Carries the numbers so callers can map it to
 * their own transport error (agent-admin and agent-memory turn it into a
 * `ServiceUnavailableException`).
 */
export class JetStreamCapacityError extends Error {
  constructor(
    message: string,
    public readonly requestedBytes: number,
    public readonly availableBytes: number
  ) {
    super(message);
    this.name = "JetStreamCapacityError";
  }
}

/** Options for {@link ensureTenantIngressStream}. */
export interface IEnsureTenantIngressStreamOptions {
  /**
   * Pre-flight the account's file storage before creating the stream, and
   * throw {@link JetStreamCapacityError} instead of letting the broker reject
   * the add with a raw error.
   *
   * OPT-IN on purpose. It costs one extra `getAccountInfo()` round-trip per
   * tenant per pod, and the default ensure sits on every publish path; 27 jsm
   * mocks across this repo implement `streams` only, so turning it on
   * unconditionally would also break unrelated suites in 10 packages. Callers
   * that already pre-flighted before this helper existed (agent-admin,
   * agent-memory) pass `true` to keep that behaviour.
   */
  readonly checkCapacity?: boolean;

  /**
   * Tier-resolved limits for the stream (tenant-messaging-tiers T02). The
   * CALLER resolves tier → `TENANT_TIER_LIMITS[tier]` →
   * `clampTenantStreamLimits(...)`; this helper stays lookup-free so the 11
   * hot-path lazy-ensure call sites keep their flat default untouched. When
   * omitted the flat `CHANNEL_STREAM_MAX_AGE_NS`/`CHANNEL_STREAM_MAX_BYTES`
   * config applies, byte-for-byte as before. Only the provisioning executor
   * passes this today; the ensure stays CREATE-only either way — applying a
   * tier to an EXISTING stream is T04's reconciliation, never this path.
   */
  readonly limits?: TenantStreamLimits;
}

/**
 * Sums the `max_bytes` reservations of every stream in the account
 * (tenant-messaging-tiers T03). NATS reserves a bounded stream's `max_bytes`
 * against the account's `max_storage`, but the client API exposes no
 * `reserved_storage` field — so an honest capacity pre-flight has to derive
 * it from `streams.list()`. Unbounded streams (`max_bytes: -1`) reserve
 * nothing and are skipped. One extra API round-trip; only the opt-in
 * `checkCapacity` path pays it.
 *
 * When `targetName` is given the scan also reports whether that stream
 * already exists, so the caller can treat the ensure as satisfied instead of
 * capacity-failing an idempotent re-ensure (the target's own `max_bytes` is
 * part of the reservations it would be judged against).
 */
export async function sumReservedStreamBytes(
  jsm: JetStreamManager,
  targetName?: string
): Promise<{ reservedBytes: number; targetExists: boolean }> {
  let reservedBytes = 0;
  let targetExists = false;
  for await (const si of jsm.streams.list()) {
    if (targetName !== undefined && si.config?.name === targetName) {
      targetExists = true;
    }
    const maxBytes = si.config?.max_bytes;
    if (typeof maxBytes === "number" && maxBytes > 0) {
      reservedBytes += maxBytes;
    }
  }
  return { reservedBytes, targetExists };
}

async function performTenantIngressEnsure(
  jsm: JetStreamManager,
  tenantId: string,
  streamName: string,
  options: IEnsureTenantIngressStreamOptions
): Promise<void> {
  const requestedMaxBytes =
    options.limits?.max_bytes ?? CHANNEL_STREAM_MAX_BYTES;
  if (options.checkCapacity === true) {
    const info = await jsm.getAccountInfo();
    // Unlimited accounts skip the reservation scan — the check below cannot
    // fail, and the existing-stream case falls through to the idempotent
    // STREAM_NAME_IN_USE add, exactly as before T03.
    if (info.limits.max_storage >= 0) {
      const { reservedBytes, targetExists } = await sumReservedStreamBytes(
        jsm,
        streamName
      );
      // The tenant's own stream showing up in the scan means the ensure is
      // ALREADY satisfied — capacity is irrelevant (its max_bytes is part of
      // the reservations) and throwing here would turn every pod restart on
      // a well-reserved account into a permanent 503 for existing tenants.
      // Caught by dual review in T03 round 1.
      if (targetExists) {
        ensuredTenantIngressStreams.add(streamName);
        return;
      }
      const check = checkJetStreamCapacity(
        requestedMaxBytes,
        info.storage,
        info.limits.max_storage,
        reservedBytes
      );
      if (!check.ok) {
        // Deliberately BEFORE the add and before seeding the cache: a capacity
        // failure must be retryable once the operator frees storage.
        throw new JetStreamCapacityError(
          check.message ?? "Insufficient JetStream file storage",
          check.requestedBytes,
          check.availableBytes
        );
      }
    }
  }

  try {
    await jsm.streams.add({
      name: streamName,
      subjects: [getTenantSubjectPattern(tenantId)],
      retention: RetentionPolicy.Limits,
      max_age: options.limits?.max_age ?? CHANNEL_STREAM_MAX_AGE_NS,
      max_bytes: requestedMaxBytes,
      ...(options.limits === undefined
        ? {}
        : {
            max_msg_size: options.limits.max_msg_size,
            num_replicas: options.limits.num_replicas,
          }),
    });
  } catch (err) {
    if (!isStreamNameInUseError(err)) {
      throw err;
    }
  }
  ensuredTenantIngressStreams.add(streamName);
}

/**
 * Idempotently ensures the per-tenant ingress stream
 * `INGRESS-<TENANT>` exists on the broker, with the canonical
 * `evt.<tenant>.>` subject filter and the platform's standard
 * retention/age/byte limits.
 *
 * **Contract**:
 * - Resolves with no return value when the stream is guaranteed to
 *   exist on the broker (either created now or pre-existing).
 * - Concurrent calls for the same tenant share a single broker
 *   round-trip (in-flight coalescing via
 *   {@link inFlightTenantIngressEnsures}).
 * - After the first success, repeated calls for the same stream name
 *   short-circuit via an O(1) `Set.has` lookup against the
 *   module-level cache — no broker contact, amortised O(1) per call.
 *
 * **Idempotency guarantee**: safe to invoke on every publish. The
 * implementation issues `streams.add` once and treats the broker's
 * `STREAM_NAME_IN_USE` (api-error code 10058 / message "stream name
 * already in use") response as a successful ensure. This is by design
 * — the helper makes no claim about reconciling drifted stream config;
 * use {@link ensureStream} when subject/limit reconciliation is
 * required.
 *
 * **Cache lifetime**: the lifetime of the Node/Bun module (i.e. the
 * pod). The cache is populated only on confirmed success — broker
 * errors other than `STREAM_NAME_IN_USE` propagate AND do NOT seed
 * the cache, so the next call retries the broker.
 *
 * **Error classes**:
 * - `STREAM_NAME_IN_USE` (10058) → swallowed, cache seeded.
 * - Any other broker / network error → rethrown to the caller without
 *   seeding the cache.
 *
 * **Single creator (2026-07-31)**: this is the ONLY place that creates
 * `INGRESS-<TENANT>`. agent-admin and agent-memory used to create the same
 * stream themselves via `buildTenantStreamConfig(tenantId, "free")`, so a new
 * tenant's stream got free-tier limits or these flat limits depending on which
 * service touched it first. Both now delegate here. Since 2026-08-01
 * (tenant-messaging-tiers T02) the provisioning executor passes
 * caller-resolved tier limits via `options.limits`; every other call site
 * stays on the flat default.
 *
 * @see REQ-RSE-002 — stream-ensure precondition before publish.
 */
export async function ensureTenantIngressStream(
  jsm: JetStreamManager,
  tenantId: string,
  options: IEnsureTenantIngressStreamOptions = {}
): Promise<void> {
  const streamName = getTenantStreamName(tenantId);
  if (ensuredTenantIngressStreams.has(streamName)) {
    return;
  }

  const existing = inFlightTenantIngressEnsures.get(streamName);
  if (existing) {
    await existing;
    return;
  }

  const pending = performTenantIngressEnsure(
    jsm,
    tenantId,
    streamName,
    options
  ).finally(() => {
    inFlightTenantIngressEnsures.delete(streamName);
  });
  inFlightTenantIngressEnsures.set(streamName, pending);
  await pending;
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
  options: EnsureConsumerOptions
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
      ...(filterSubjects ? { filter_subjects: [...filterSubjects] } : {}),
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
  options: IJetStreamManagerBootstrapOptions
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
  opts: IJetStreamDurableConsumerProviderOptions
): FactoryProvider<Promise<Consumer>> {
  return {
    provide: opts.provide,
    inject: [NATS_CONNECTION, opts.managerToken],
    useFactory: async (
      nc: NatsConnection,
      _jm: JetStreamManager
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
  opts: IJetStreamPublisherProviderOptions
): FactoryProvider<JetStreamClient> {
  return {
    provide: opts.provide,
    inject: [NATS_CONNECTION, opts.managerToken],
    useFactory: (nc: NatsConnection, _jm: JetStreamManager): JetStreamClient =>
      nc.jetstream(),
  };
}
