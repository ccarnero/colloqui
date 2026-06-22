import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { catchError, forkJoin, map, of, type Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import { assembleTrace } from "../../features/processes/trace/domain/assemble-trace";
import type {
  IRecentTrace,
  ITraceNodeInput,
  ITraceResult,
  TraceVerdict,
} from "../../features/processes/trace/domain/message-trace.model";

const AUDIT = `${environment.apiUrl}/audit`;
const WORKFLOWS = `${environment.apiUrl}/workflows`;

interface IAuditListResponse {
  events?: unknown[];
}

/** Assembled business trace plus the tech-trace deep-link keys. */
export interface ITraceView {
  readonly result: ITraceResult;
  readonly traceId: string | null;
  readonly temporalWorkflowId: string | null;
}

/**
 * Reads the audit list endpoints and assembles the message trace client-side.
 * Slice 1 uses only existing gateway endpoints — see
 * `.sdd/changes/processes-message-trace/`.
 */
@Injectable({ providedIn: "root" })
export class MessageTraceService {
  private readonly http = inject(HttpClient);

  /**
   * Resolve a platform event id to its correlation_id (reverse lookup entry
   * point). Uses the existing gateway by-id routes — no backend change. Tries
   * the channel-events store first, then the platform events store.
   */
  resolveCorrelation(eventId: string): Observable<string | null> {
    const id = encodeURIComponent(eventId);
    return this.http.get<Row>(`${AUDIT}/channel-events/${id}`).pipe(
      map((row) => correlationOf(row) ?? null),
      catchError(() =>
        this.http.get<Row>(`${AUDIT}/events/${id}`).pipe(
          map((row) => correlationOf(row) ?? null),
          catchError(() => of<string | null>(null)),
        ),
      ),
    );
  }

  /** The 10 most recent traces (business correlation + tech traceid), newest first. */
  recentTraces(
    windowMin = 1440,
    limit = 500,
    filter?: { accountId?: string; channel?: string },
  ): Observable<IRecentTrace[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    let params = new HttpParams()
      .set("from", from)
      .set("limit", String(limit));
    if (filter?.accountId) params = params.set("accountId", filter.accountId);
    if (filter?.channel)   params = params.set("channel",   filter.channel);
    return this.http
      .get<IAuditListResponse>(`${AUDIT}/channel-events`, { params })
      .pipe(map((res) => groupRecent(asRows(res))));
  }

  /**
   * Full trace for one correlation_id: causal chain + pub/sub + tech keys.
   *
   * The gateway audit proxy does not whitelist a `correlation_id` filter (only
   * `from`/`to`/`limit`), so Slice 1 fetches a time window and filters
   * client-side. Recent traffic (the common debug case) is covered by the
   * default window; arbitrary-age lookup needs a correlation-scoped endpoint
   * (gateway `chain/:id` passthrough) — see `.sdd/changes/processes-message-trace/`.
   */
  getTrace(correlationId: string, windowMin = 60): Observable<ITraceView> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams().set("from", from).set("limit", "500");
    const channel$ = this.http.get<IAuditListResponse>(
      `${AUDIT}/channel-events`,
      { params },
    );
    const platform$ = this.http
      .get<IAuditListResponse>(`${AUDIT}/events`, { params })
      .pipe(catchError(() => of<IAuditListResponse>({ events: [] })));
    // The run record (keyed by correlation_id) carries temporal_workflow_id
    // and status — gives us a workflow node + the Temporal deep link.
    const executions$ = this.http
      .get<unknown[]>(`${WORKFLOWS}/executions`, {
        params: new HttpParams().set("correlation_id", correlationId),
      })
      .pipe(catchError(() => of<unknown[]>([])));
    return forkJoin({
      channel: channel$,
      platform: platform$,
      executions: executions$,
    }).pipe(
      map(({ channel, platform, executions }) => {
        const channelRows = asRows(channel).filter(
          (r) => correlationOf(r) === correlationId,
        );
        const platformRows = asRows(platform).filter(
          (r) => correlationOf(r) === correlationId,
        );
        const execRows: Row[] = Array.isArray(executions)
          ? (executions as Row[])
          : [];
        const inputs: ITraceNodeInput[] = [
          ...channelRows.map((r) => normalize(r, "channel")),
          ...platformRows.map((r) => normalize(r, "platform")),
          ...execRows.map(toWorkflowNode),
        ];
        const result = assembleTrace(correlationId, inputs);
        return {
          result,
          traceId: firstTraceId([...channelRows, ...platformRows]),
          temporalWorkflowId:
            field(execRows[0] ?? {}, "temporalWorkflowId", "temporal_workflow_id") ??
            firstTemporalWorkflowId(platformRows),
        };
      }),
    );
  }
}

type Row = Record<string, unknown>;

function asRows(res: IAuditListResponse | null): Row[] {
  const events = res?.events;
  return Array.isArray(events) ? (events as Row[]) : [];
}

/** camelCase or snake_case tolerant field read. */
function field(row: Row, camel: string, snake: string): string | undefined {
  const v = row[camel] ?? row[snake];
  return typeof v === "string" ? v : v == null ? undefined : String(v);
}

function num(row: Row, camel: string, snake: string): number {
  const v = row[camel] ?? row[snake];
  return typeof v === "number" ? v : 0;
}

function correlationOf(row: Row): string | undefined {
  return field(row, "correlationId", "correlation_id");
}

function normalize(row: Row, source: "channel" | "platform"): ITraceNodeInput {
  const kind =
    field(row, "kind", "kind") ?? field(row, "type", "type") ?? "event";
  return {
    id: field(row, "id", "id") ?? "",
    kind,
    subject: field(row, "natsSubject", "subject") ?? "",
    causationId: field(row, "causationId", "causation_id") ?? null,
    depth: num(row, "depth", "depth"),
    createdAt: field(row, "createdAt", "created_at") ?? "",
    from: field(row, "from", "from"),
    to: field(row, "to", "to"),
    text: field(row, "text", "text"),
    accountId: field(row, "accountId", "account_id"),
    source,
  };
}

function toWorkflowNode(e: Row): ITraceNodeInput {
  return {
    id: field(e, "id", "id") ?? "",
    kind: "workflow run",
    subject: "",
    causationId: null,
    depth: 1,
    createdAt: field(e, "createdAt", "created_at") ?? "",
    source: "platform",
  };
}

function metadata(row: Row): Row {
  const m = row["metadata"];
  return m && typeof m === "object" ? (m as Row) : {};
}

function firstTraceId(rows: Row[]): string | null {
  for (const r of rows) {
    const t = field(r, "traceId", "traceid") ?? field(metadata(r), "traceId", "traceid");
    if (t) return t;
  }
  return null;
}

function firstTemporalWorkflowId(rows: Row[]): string | null {
  for (const r of rows) {
    const m = metadata(r);
    const id =
      field(r, "temporalWorkflowId", "temporal_workflow_id") ??
      field(m, "temporalWorkflowId", "temporal_workflow_id");
    if (id) return id;
  }
  return null;
}

interface RecentAcc {
  correlationId: string;
  channel: string;
  lastAt: string;
  traceId?: string;
  hasSend: boolean;
  hasSent: boolean;
}

function groupRecent(rows: Row[]): IRecentTrace[] {
  const byCid = new Map<string, RecentAcc>();
  for (const r of rows) {
    const cid = correlationOf(r);
    if (!cid) continue;
    const createdAt = field(r, "createdAt", "created_at") ?? "";
    const kind = field(r, "kind", "kind") ?? "";
    const acc: RecentAcc = byCid.get(cid) ?? {
      correlationId: cid,
      channel: channelFromSubject(field(r, "natsSubject", "subject") ?? ""),
      lastAt: createdAt,
      hasSend: false,
      hasSent: false,
    };
    if (createdAt > acc.lastAt) acc.lastAt = createdAt;
    if (kind === "send") acc.hasSend = true;
    if (kind === "sent") acc.hasSent = true;
    if (!acc.traceId) {
      acc.traceId =
        field(r, "traceId", "traceid") ??
        field(metadata(r), "traceId", "traceid");
    }
    byCid.set(cid, acc);
  }
  return [...byCid.values()]
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
    .slice(0, 10)
    .map((a) => ({
      correlationId: a.correlationId,
      channel: a.channel,
      verdict: recentVerdict(a),
      lastAt: a.lastAt,
      traceId: a.traceId,
    }));
}

function recentVerdict(a: RecentAcc): TraceVerdict {
  if (a.hasSent) return "replied";
  if (a.hasSend) return "published-unconfirmed";
  return "received";
}

function channelFromSubject(subject: string): string {
  const tokens = subject.split(".");
  return tokens.length >= 5 ? tokens[4] : "—";
}
