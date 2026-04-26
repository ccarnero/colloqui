import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
} from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import {
  buildDlqStreamName,
  getTenantStreamName,
} from "@yoizen/shared";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import {
  DLQ_STREAM_KIND,
  INGRESS_STREAM_KIND,
  streamNameFor,
} from "./streams.constants";
import type {
  IStreamMessage,
  IStreamSummary,
  StreamInspectionMode,
} from "./streams.dto";

const MESSAGE_FETCH_LIMIT = 50;
/** Upper bound on JetStream fetch batch when post-filtering by accountId. */
const MAX_ACCOUNT_INSPECT_FETCH = 200;
const ACCOUNT_INSPECT_SCAN_FACTOR = 4;
const MESSAGE_FETCH_TIMEOUT_MS = 2_000;

const TRAILING_GT = ".>";

/** Reads CloudEvents-style `accountid` from a decoded JetStream payload. */
export function extractEnvelopeAccountId(data: unknown): string | null {
  if (data !== null && typeof data === "object" && "accountid" in data) {
    const v = (data as { accountid?: unknown }).accountid;
    return typeof v === "string" && v.length > 0 ? v : null;
  }
  return null;
}

interface IStreamInfoShape {
  config?: {
    subjects?: string[];
    max_age?: number;
    max_bytes?: number;
  };
  state?: {
    messages?: number | bigint;
    bytes?: number | bigint;
    first_seq?: number | bigint;
    last_seq?: number | bigint;
    first_ts?: string;
    last_ts?: string;
    consumer_count?: number;
  };
}

/**
 * Serves admin-console queries over the tenant's JetStream streams.
 * Exposes two surfaces:
 *
 *   - metadata for the INGRESS + DLQ streams (dimensions, retention,
 *     seq/ts windows) via `jsm.streams.info` — a single JSAPI call
 *     per request.
 *   - recent messages served through an ephemeral pull consumer so
 *     we never pollute the tenant's durable consumer catalog and the
 *     stream cursor stays untouched.
 *
 * Two inspection modes are supported:
 *   - `last-per-subject` (default): returns the last message for each
 *     subject that matches the filter. NATS mandates a `filter_subject`
 *     for this deliver policy, so when the client omits one we fall
 *     back to the stream's first bound subject pattern (guaranteed
 *     subset and equivalent to "any subject in the stream").
 *   - `tail`: returns the last N messages by sequence regardless of
 *     subject, using `DeliverPolicy.StartSequence` with a computed
 *     `opt_start_seq`. Useful for "show me what just happened".
 *
 * With optional `accountId`, fetches up to `min(limit·4, 200)` candidates
 * and post-filters by `envelope.accountid` — O(fetchCap) per request.
 */
@Injectable()
export class StreamsService {
  private readonly logger = new PinoLoggerService(StreamsService.name);

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
  ) {}

  async listStreams(tenantId: string): Promise<readonly IStreamSummary[]> {
    const ingressName = getTenantStreamName(tenantId);
    const dlqName = buildDlqStreamName(tenantId);

    const [ingress, dlq] = await Promise.all([
      this.safeInfo(ingressName),
      this.safeInfo(dlqName),
    ]);

    const out: IStreamSummary[] = [];
    if (ingress) out.push(this.toSummary(ingressName, "ingress", ingress));
    if (dlq) out.push(this.toSummary(dlqName, "dlq", dlq));
    return out;
  }

  async getMessages(
    tenantId: string,
    key: string,
    subject: string | undefined,
    limit: number | undefined,
    mode: StreamInspectionMode = "last-per-subject",
    accountId?: string,
  ): Promise<readonly IStreamMessage[]> {
    const kind = this.parseKind(key);
    const streamName = streamNameFor(kind, tenantId);

    const info = await this.safeInfo(streamName);
    if (!info) throw new NotFoundException(`stream '${streamName}' not found`);

    const streamSubjects = info.config?.subjects ?? [];

    if (subject && !this.isSubjectSubset(subject, streamSubjects)) {
      throw new BadRequestException(
        `subject filter '${subject}' is not a subset of stream subjects [${streamSubjects.join(", ")}]`,
      );
    }

    const resultLimit = Math.min(limit ?? 20, MESSAGE_FETCH_LIMIT);
    const scanCap = accountId
      ? Math.min(
          resultLimit * ACCOUNT_INSPECT_SCAN_FACTOR,
          MAX_ACCOUNT_INSPECT_FETCH,
        )
      : resultLimit;
    const ephemeralName = `ui-inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const consumerConfig = this.buildConsumerConfig({
      mode,
      ephemeralName,
      subject,
      streamName,
      streamSubjects,
      state: info.state ?? {},
      scanCap,
    });

    try {
      await this.jsm.consumers.add(streamName, consumerConfig as never);
    } catch (err) {
      throw new BadRequestException(
        `failed to create inspection consumer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const consumer = await this.js.consumers.get(streamName, ephemeralName);
      const iter = await consumer.fetch({
        max_messages: scanCap,
        expires: MESSAGE_FETCH_TIMEOUT_MS,
      });

      const decoder = new TextDecoder();
      const out: IStreamMessage[] = [];
      for await (const msg of iter) {
        const row = this.toMessage(msg, decoder);
        if (accountId) {
          const envAccount = extractEnvelopeAccountId(row.data);
          if (envAccount !== accountId) continue;
        }
        out.push(row);
        if (out.length >= resultLimit) break;
      }
      return out;
    } finally {
      this.safeDeleteConsumer(streamName, ephemeralName);
    }
  }

  /**
   * Builds the JetStream ephemeral consumer config tailored to the
   * requested inspection mode. Kept as a pure helper so the shape is
   * easy to unit-test and the caller in `getMessages` stays linear.
   */
  private buildConsumerConfig(input: {
    readonly mode: StreamInspectionMode;
    readonly ephemeralName: string;
    readonly subject: string | undefined;
    readonly streamName: string;
    readonly streamSubjects: readonly string[];
    readonly state: NonNullable<IStreamInfoShape["state"]>;
    /** Window size for tail start-seq and max fetch batch. */
    readonly scanCap: number;
  }): Record<string, unknown> {
    const {
      mode,
      ephemeralName,
      subject,
      streamName,
      streamSubjects,
      state,
      scanCap,
    } = input;

    const base = {
      name: ephemeralName,
      ack_policy: AckPolicy.None,
      replay_policy: ReplayPolicy.Instant,
      inactive_threshold: 60 * 1_000_000_000,
    } as const;

    if (mode === "tail") {
      const lastSeq = Number(state.last_seq ?? 0);
      const firstSeq = Number(state.first_seq ?? 0);
      const startSeq =
        lastSeq > 0 ? Math.max(firstSeq || 1, lastSeq - scanCap + 1) : 1;
      return {
        ...base,
        deliver_policy: DeliverPolicy.StartSequence,
        opt_start_seq: startSeq,
        ...(subject ? { filter_subject: subject } : {}),
      };
    }

    // last-per-subject (default).
    // NATS mandates `filter_subject` for LastPerSubject; fall back to
    // the stream's first subject pattern so the caller can omit it.
    const fallback = streamSubjects[0];
    if (!subject && !fallback) {
      throw new BadRequestException(
        `stream '${streamName}' has no bound subjects`,
      );
    }
    return {
      ...base,
      deliver_policy: DeliverPolicy.LastPerSubject,
      filter_subject: subject ?? fallback,
    };
  }

  /**
   * Cheap subset check: accepts a filter if it equals one of the
   * stream subjects or shares the literal prefix that precedes a
   * trailing `.>` wildcard. Covers the realistic patterns we bind
   * today (`evt.<tenant>.>`, `dlq.<tenant>.>`, explicit subjects).
   * O(N) over the number of bound subjects (always ≤ 2 in practice).
   */
  private isSubjectSubset(
    filter: string,
    streamSubjects: readonly string[],
  ): boolean {
    for (const s of streamSubjects) {
      if (s === filter) return true;
      if (s.endsWith(TRAILING_GT)) {
        const prefix = s.slice(0, s.length - 1); // keep trailing dot
        if (filter === s) return true;
        if (filter.startsWith(prefix) || filter === prefix.slice(0, -1)) {
          return true;
        }
      }
    }
    return false;
  }

  private async safeInfo(streamName: string): Promise<IStreamInfoShape | null> {
    try {
      return (await this.jsm.streams.info(streamName)) as IStreamInfoShape;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("no stream")) {
        return null;
      }
      throw err;
    }
  }

  private safeDeleteConsumer(stream: string, name: string): void {
    void this.jsm.consumers.delete(stream, name).catch((err: unknown) => {
      this.logger.warn(
        `failed to delete ephemeral consumer '${name}' on '${stream}': ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private toSummary(
    name: string,
    kind: "ingress" | "dlq",
    info: IStreamInfoShape,
  ): IStreamSummary {
    const cfg = info.config ?? {};
    const state = info.state ?? {};
    return {
      name,
      kind,
      subjects: cfg.subjects ?? [],
      messages: Number(state.messages ?? 0),
      bytes: Number(state.bytes ?? 0),
      firstSeq: Number(state.first_seq ?? 0),
      lastSeq: Number(state.last_seq ?? 0),
      firstTs: state.first_ts ?? null,
      lastTs: state.last_ts ?? null,
      maxAgeNs: cfg.max_age ?? 0,
      maxBytes: cfg.max_bytes ?? 0,
      consumerCount: state.consumer_count ?? 0,
    };
  }

  private toMessage(
    msg: {
      seq: number;
      subject: string;
      data: Uint8Array;
      headers?: unknown;
      info?: { timestampNanos?: string | number };
    },
    decoder: TextDecoder,
  ): IStreamMessage {
    const raw = msg.data;
    const size = raw.byteLength;
    let data: unknown = null;
    try {
      data = JSON.parse(decoder.decode(raw));
    } catch {
      data = decoder.decode(raw);
    }
    const headers: Record<string, string> = {};
    const hdrs = msg.headers as
      | { keys?: () => Iterable<string>; get?: (k: string) => string }
      | null
      | undefined;
    if (
      hdrs &&
      typeof hdrs.keys === "function" &&
      typeof hdrs.get === "function"
    ) {
      const keys = hdrs.keys;
      const get = hdrs.get;
      for (const k of keys.call(hdrs)) {
        headers[k] = get.call(hdrs, k);
      }
    }
    const tsNanos = msg.info?.timestampNanos;
    const ts =
      typeof tsNanos === "string"
        ? new Date(Number(BigInt(tsNanos) / 1_000_000n)).toISOString()
        : typeof tsNanos === "number"
          ? new Date(tsNanos / 1_000_000).toISOString()
          : new Date().toISOString();
    return {
      seq: msg.seq,
      subject: msg.subject,
      ts,
      headers,
      data,
      size,
    };
  }

  private parseKind(key: string): "ingress" | "dlq" {
    if (key === INGRESS_STREAM_KIND) return "ingress";
    if (key === DLQ_STREAM_KIND) return "dlq";
    throw new BadRequestException(
      `unknown stream key '${key}' (expected 'ingress' | 'dlq')`,
    );
  }
}
