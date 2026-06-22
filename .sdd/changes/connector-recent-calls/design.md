# Design — connector-recent-calls

## Summary

Add a **connector detail page** at `/connections/http/:id` in the admin console with a
**Recent calls** section showing the last 20 `endpointCall` invocations for that adapter
(method, URL, HTTP status, duration, cache hit/miss). Source data is a new lightweight
NATS event emitted by `connector-runtime` per HTTP call, persisted automatically by
`audit-service`, and read back through the existing `GET /audit/events` gateway proxy.

Gated by the `diagnostics:read` permission, mirroring the recently shipped
`channel-trace-entry` / `ChannelDetailComponent` pattern.

---

## Hard constraints discovered during exploration (read before coding)

1. **Audit consumer subject is `evt.*.*.platform.>`** (not the legacy `EVENTS` stream).
   `services/audit-service/src/modules/audit/audit.service.ts:47` binds a per-tenant
   durable consumer (`audit-events`) over `INGRESS-<tenant>` streams with
   `filterSubject = "evt.*.*.platform.>"`. The **3rd subject token (domain) MUST be
   `platform`** or the event is never persisted. Our publish subject must therefore be:
   ```
   evt.<tenant>.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1
   ```
   Publishing this subject lands the message in `INGRESS-<tenant>` (whose subjects are
   `evt.<tenant>.>`, per `getTenantSubjectPattern`) and the audit writer picks it up.

2. **Persisted row shape** (`audit.postgres.repository.ts`): `payload = envelope.data.payload`,
   plus columns `id, type, payload, metadata, subject, created_at, correlation_id, causation_id, depth`.
   So every field we put in `data.payload` is readable as `event.payload.<field>`.

3. **`type` is an exact-match SQL filter.** The query `?type=connector.endpoint_call.completed.v1`
   matches the persisted `envelope.type` column verbatim. The CloudEvents `type` and the NATS
   `subject` are DIFFERENT strings — keep both.

4. **Gateway proxy whitelist for `GET /audit/events`** (`audit-proxy-query.dto.ts` +
   `audit-query-params.util.ts`) only forwards `type, from, to, limit, offset`.
   There is **no `adapterId` filter** — adapter filtering MUST be client-side.

5. **`GET /audit/events` response shape** is `{ events: T[], limit, offset }`
   (`audit-list-helpers.ts`). The admin console reads `res.events`.

6. **`connector-runtime` has no NATS client today** and is a plain Temporal worker
   (`worker.ts` → `runTemporalWorkerCli`), NOT a NestJS app. We add a lazy singleton,
   not a Nest provider.

7. **`EndpointCallArgs`** (`packages/shared/src/workflow.interfaces.ts:73`) carries
   `method, url, adapterId?, endpointId?, params?, data?, headers?` — **no correlationId**.
   The business-flow correlation is not plumbed into the activity, so we do NOT fabricate
   a trace deep-link from it (see ADR D6).

---

## A. connector-runtime — emit the NATS event

### A.1 Config — add `natsUrl`

`services/connector-runtime/src/config.ts`

Add to `WorkflowHttpWorkerConfig` and the literal:
```ts
readonly natsUrl: string;
// ...
natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
```

### A.2 `IHttpCallResult` — add `cacheResult`

`services/connector-runtime/src/activities/_shared/http-call-with-retry.ts`
```ts
export type EndpointCacheResult = "hit" | "miss" | "bypass" | null;

export interface IHttpCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  cacheResult?: EndpointCacheResult; // NEW — cache outcome for this call
}
```

### A.3 Thread the cache outcome out of `cachedFetch`

`cachedFetch` already records the outcome to OTel but returns only `Response`. Add an
**optional callback** to `ICachedFetchContext` so callers can capture the first decisive
result without changing the metrics behaviour.

`services/connector-runtime/src/activities/_shared/http-cache/cached-fetch.ts`
```ts
export interface ICachedFetchContext {
  readonly decision: IHttpResponseCachePolicyDecision;
  readonly cache: IHttpResponseCache;
  readonly fetchFn: typeof globalThis.fetch;
  /** Invoked once with the first decisive cache outcome (hit/miss/bypass). */
  readonly onCacheResult?: (result: HttpResponseCacheResultValue) => void;
}
```
At the three existing `recordHttpResponseCache(...)` call sites that represent a
**decisive** outcome, also call `context.onCacheResult?.(...)`:
- `HttpResponseCacheResult.BYPASS` (policy null + redis-error fallback) → `onCacheResult(BYPASS)`
- `HttpResponseCacheResult.HIT` → `onCacheResult(HIT)`
- `HttpResponseCacheResult.MISS` → `onCacheResult(MISS)`

Do NOT fire it for `STORE` / `STORE_SKIP` (they happen after a MISS). The helper maps
`HttpResponseCacheResultValue → EndpointCacheResult`:
```ts
// services/connector-runtime/src/activities/_shared/http-cache/to-cache-result.ts
export function toEndpointCacheResult(
  r: HttpResponseCacheResultValue,
): EndpointCacheResult {
  if (r === HttpResponseCacheResult.HIT) return "hit";
  if (r === HttpResponseCacheResult.MISS) return "miss";
  if (r === HttpResponseCacheResult.BYPASS) return "bypass";
  return null; // store/store_skip — not decisive on their own
}
```

`httpCallWithRetry` (same file as A.2) captures it:
```ts
let cacheResult: EndpointCacheResult = null;
// inside the attempt, when building cache context:
const res = options.cache
  ? await cachedFetch(url, requestInit, {
      decision: options.cache.decision,
      cache: options.cache.store,
      fetchFn: tracedFetch,
      onCacheResult: (r) => { cacheResult ??= toEndpointCacheResult(r); },
    })
  : await tracedFetch(url, requestInit);
// ...
return { ...(await buildResult(res)), cacheResult };
```
`buildResult` keeps returning `{ status, data, headers }`; the spread adds `cacheResult`.

### A.4 Event publisher (lazy singleton)

New file `services/connector-runtime/src/activities/_shared/event-publisher.ts`
(one exported function + module-private lazy state; mirrors `adapter-client.provider.ts`
and `gateway-audit-publish.util.ts`):

```ts
import { connect, headers as natsHeaders } from "nats";
import type { JetStreamClient, NatsConnection } from "nats";
import {
  buildEventEnvelope,
  buildSubject,
  TENANT_HEADER,
} from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { workflowHttpWorkerConfig } from "../../config";
import type { EndpointCacheResult } from "./http-call-with-retry";

const logger = new PinoLoggerService("connector-runtime-events");
const encoder = new TextEncoder();
const MAX_URL_LEN = 120;

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;

async function getJetStream(): Promise<JetStreamClient> {
  if (js) return js;
  nc = await connect({
    servers: workflowHttpWorkerConfig.natsUrl,
    name: "connector-runtime",
    waitOnFirstConnect: true,
  });
  js = nc.jetstream();
  return js;
}

export interface IEndpointCallEvent {
  readonly tenantId: string;
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: EndpointCacheResult;
}

/** Fire-and-forget. Never throws — telemetry must not break the activity. */
export function publishEndpointCallEvent(evt: IEndpointCallEvent): void {
  void emit(evt).catch((err) =>
    logger.warn(
      `endpoint_call event publish failed: ${err instanceof Error ? err.message : String(err)}`,
    ),
  );
}

async function emit(evt: IEndpointCallEvent): Promise<void> {
  const jsClient = await getJetStream();
  const payload = {
    adapterId: evt.adapterId,
    endpointId: evt.endpointId,
    method: evt.method,
    resolvedUrl: truncateUrl(evt.resolvedUrl),
    status: evt.status,
    durationMs: evt.durationMs,
    cacheResult: evt.cacheResult,
  };
  const envelope = buildEventEnvelope({
    type: "connector.endpoint_call.completed.v1",
    source: "//connector-runtime/endpoint-call",
    resource: `adapter/${evt.adapterId}`,
    tenant: evt.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    accountid: "system",
    payload,
    transport: { method: "stream", protocol: "internal", depth: 0 },
  });
  const subject = buildSubject({
    tenant: evt.tenantId,
    producer: "connector-runtime",
    domain: "platform",
    channel: "endpoint",
    provider: "system",
    kind: "endpoint_call_completed",
  });
  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, evt.tenantId);
  await jsClient.publish(subject, encoder.encode(JSON.stringify(envelope)), {
    headers: hdrs,
  });
}

/** Keep the stored URL bounded; the full URL is the upstream target anyway. */
function truncateUrl(url: string): string {
  return url.length > MAX_URL_LEN ? `${url.slice(0, MAX_URL_LEN)}…` : url;
}
```

Subject produced: `evt.<tenant>.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1`
→ matches `evt.*.*.platform.>`. CloudEvents `type` persisted: `connector.endpoint_call.completed.v1`.

### A.5 Call the publisher from the activity

`services/connector-runtime/src/activities/endpoint-call.activity.ts`

Emit inside each of the three branch helpers, where `url` (resolved) and method are in
scope, immediately after the call returns and before returning the result. Example for
`executeWithAdapterEndpoint` (apply the same shape to `executeWithAdapterBase` and
`executeRaw`):

```ts
const startedAt = Date.now();
const result = await httpCallWithRetry({ /* …unchanged… */ });
publishEndpointCallEvent({
  tenantId,
  adapterId: args.adapterId!,
  endpointId: args.endpointId ?? null, // null for base/raw branches
  method: resolved.method,             // args.method for raw branch
  resolvedUrl: url,
  status: result.status,
  durationMs: Date.now() - startedAt,
  cacheResult: result.cacheResult ?? null,
});
return result;
```
- `executeWithAdapterBase`: `endpointId: null`, `method: resolved.method`.
- `executeRaw`: `adapterId: ""` is invalid → for the raw branch there is no adapter,
  so SKIP the publish (no connector to attribute the call to). Only the two adapter
  branches emit.

Failure semantics: `httpCallWithRetry` returns a response for all HTTP statuses except
transport errors / exhausted retries (which throw). On throw we do NOT emit — v1 records
only calls that produced an HTTP status (see ADR D7).

---

## B. Admin console — `ConnectorCallService`

New file `services/admin-console/src/app/core/services/connector-call.service.ts`
(analogous to `message-trace.service.ts`).

```ts
import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { map, type Observable } from "rxjs";
import { environment } from "../../../environments/environment";

const AUDIT = `${environment.apiUrl}/audit`;
const EVENT_TYPE = "connector.endpoint_call.completed.v1";
/** Over-fetch so client-side adapter filtering still yields `limit` rows. */
const FETCH_LIMIT = 200;

export type ConnectorCacheResult = "hit" | "miss" | "bypass" | null;

export interface IConnectorCall {
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: ConnectorCacheResult;
  readonly timestamp: string;
  readonly correlationId?: string;
}

interface IAuditListResponse { events?: AuditRow[]; }
type AuditRow = Record<string, unknown>;

@Injectable({ providedIn: "root" })
export class ConnectorCallService {
  private readonly http = inject(HttpClient);

  recentCalls(
    adapterId: string,
    windowMin = 60,
    limit = 20,
  ): Observable<IConnectorCall[]> {
    const from = new Date(Date.now() - windowMin * 60_000).toISOString();
    const params = new HttpParams()
      .set("type", EVENT_TYPE)
      .set("from", from)
      .set("limit", String(FETCH_LIMIT));
    return this.http
      .get<IAuditListResponse>(`${AUDIT}/events`, { params })
      .pipe(
        map((res) =>
          (res.events ?? [])
            .map(toCall)
            .filter((c): c is IConnectorCall => c !== null && c.adapterId === adapterId)
            .slice(0, limit),
        ),
      );
  }
}

function toCall(row: AuditRow): IConnectorCall | null {
  const payload = (row["payload"] ?? {}) as Record<string, unknown>;
  const adapterId = str(payload["adapterId"]);
  if (!adapterId) return null;
  return {
    adapterId,
    endpointId: str(payload["endpointId"]) || null,
    method: str(payload["method"]) || "GET",
    resolvedUrl: str(payload["resolvedUrl"]),
    status: num(payload["status"]),
    durationMs: num(payload["durationMs"]),
    cacheResult: (str(payload["cacheResult"]) || null) as ConnectorCacheResult,
    timestamp: str(row["created_at"]) || str(row["createdAt"]),
    correlationId: str(row["correlation_id"]) || str(row["correlationId"]) || undefined,
  };
}

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function num(v: unknown): number { return typeof v === "number" ? v : 0; }
```

`from` is sorted newest-first by the repository (`ORDER BY created_at DESC`), so `slice`
keeps the most recent.

---

## C. Admin console — `ConnectorDetailComponent`

New file
`services/admin-console/src/app/features/data-integrations/connectors/detail/connector-detail.component.ts`
(standalone, OnPush, signals — mirrors `channel-detail.component.ts`).

Loads the adapter via the existing `HttpAdapterService.get(id)` (returns `IAdapterDto`).

### Sections
1. **Connector info** — `dto.name`, `dto.baseUrl`, `dto.authType`, `dto.endpoints.length`.
2. **Cache configuration** — render only when
   `dto.defaultCache?.enabled || dto.endpoints.some(e => e.cache?.enabled)`. Show
   `ttlSeconds`, `keyQueryParams`, `keyHeaders`, `keyBody`, `methods` from `defaultCache`
   (and per-endpoint cache rows when present).
3. **Recent calls** — gated by `diagnostics:read` via `auth.hasPermission("diagnostics:read")`,
   same `canViewCalls()` computed + spinner / empty-state / `@for` pattern.

### Component skeleton
```ts
const DIAGNOSTICS_PERMISSION = "diagnostics:read";

@Component({
  selector: "app-connector-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    PageHeaderComponent,
  ],
  template: `…`, // see section E for the Recent-calls block
})
export class ConnectorDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly adapters = inject(HttpAdapterService);
  private readonly calls = inject(ConnectorCallService);
  private readonly auth = inject(AuthService);
  private readonly destroy$ = new Subject<void>();

  readonly adapter = signal<IAdapterDto | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly recentCalls = signal<IConnectorCall[]>([]);
  readonly callsLoading = signal(false);
  readonly canViewCalls = computed(() =>
    this.auth.hasPermission(DIAGNOSTICS_PERMISSION),
  );
  readonly hasCacheConfig = computed(() => {
    const a = this.adapter();
    if (!a) return false;
    return !!a.defaultCache?.enabled || a.endpoints.some((e) => !!e.cache?.enabled);
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get("id");
      if (id) this.load(id);
    });
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private load(id: string): void {
    this.loading.set(true);
    this.adapters.get(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (dto) => { this.adapter.set(dto); this.loading.set(false); this.loadCalls(id); },
      error: () => { this.errorMessage.set("Failed to load connector"); this.loading.set(false); },
    });
  }
  private loadCalls(id: string): void {
    if (!this.canViewCalls()) return;
    this.callsLoading.set(true);
    this.calls.recentCalls(id, 60, 20).pipe(takeUntil(this.destroy$)).subscribe({
      next: (rows) => { this.recentCalls.set(rows); this.callsLoading.set(false); },
      error: () => { this.recentCalls.set([]); this.callsLoading.set(false); },
    });
  }

  shortUrl(url: string): string { return url.length > 120 ? `${url.slice(0,120)}…` : url; }
  statusClass(s: number): string {
    if (s >= 500) return "st-5xx";
    if (s >= 400) return "st-4xx";
    if (s >= 300) return "st-3xx";
    return "st-2xx";
  }
}
```

### Route registration
`services/admin-console/src/app/app.routes.ts`, inside the data-integrations
`connections` children block, **after** the `http/internal` & `http/external`
back-compat redirects (so they keep matching) and before `mcp`:
```ts
{
  path: "http/:id",
  loadComponent: () =>
    import(
      "./features/data-integrations/connectors/detail/connector-detail.component"
    ).then((m) => m.ConnectorDetailComponent),
},
```

---

## D. List page → detail navigation

`services/admin-console/src/app/features/data-integrations/connectors/connectors.component.ts`

Add `Router` (`private readonly router = inject(Router)`) and a **View** icon button in
the existing `actions` column, before the Edit button:
```html
<button type="button" mat-icon-button aria-label="View"
        (click)="view(r.id)">
  <mat-icon>visibility</mat-icon>
</button>
```
```ts
view(id: string): void {
  void this.router.navigate(["/connections/http", id]);
}
```
Keep Edit/Delete unchanged. (Row-click is avoided to not conflict with the existing
action buttons.)

---

## E. Recent-calls template block

Mirror the channel-detail `@if (canViewTraces())` block:
```html
@if (canViewCalls()) {
  <section class="section">
    <h3 class="section-title">Recent calls</h3>
    @if (callsLoading()) {
      <div class="loader"><mat-spinner diameter="24"></mat-spinner><span>Loading recent calls…</span></div>
    } @else if (recentCalls().length === 0) {
      <p class="no-calls">No calls in the last hour.</p>
    } @else {
      <div class="call-list">
        @for (c of recentCalls(); track $index) {
          @if (c.correlationId) {
            <a class="call-row" [routerLink]="['/processes/trace', c.correlationId]">
              <ng-container *ngTemplateOutlet="callCols; context: { c }"></ng-container>
            </a>
          } @else {
            <div class="call-row">
              <ng-container *ngTemplateOutlet="callCols; context: { c }"></ng-container>
            </div>
          }
        }
      </div>
    }
  </section>
}

<ng-template #callCols let-c="c">
  <span class="call-ts">{{ c.timestamp }}</span>
  <span class="call-method">{{ c.method }}</span>
  <span class="call-status" [class]="statusClass(c.status)">{{ c.status }}</span>
  <span class="call-dur">{{ c.durationMs }}ms</span>
  <span class="call-url" [title]="c.resolvedUrl">{{ shortUrl(c.resolvedUrl) }}</span>
  @if (hasCacheConfig() && c.cacheResult) {
    <span class="call-cache" [class]="'cache-' + c.cacheResult">{{ c.cacheResult }}</span>
  }
</ng-template>
```
Columns: timestamp, method, HTTP status badge (`statusClass`), duration, truncated URL
(full in `title`), cache badge (only when the connector has cache configured AND the call
has a `cacheResult`). Deep-link to `/processes/trace/:correlationId` only when
`correlationId` is present (v1: usually absent — see ADR D6).

Import `NgTemplateOutlet` (from `@angular/common`) and `RouterLink` in the component.

---

## Data flow (end to end)
```
endpointCall activity (2 adapter branches)
  └─ publishEndpointCallEvent  → js.publish(evt.<t>.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1)
        └─ INGRESS-<tenant> stream
              └─ audit-events durable consumer (filter evt.*.*.platform.>)
                    └─ INSERT INTO events (type='connector.endpoint_call.completed.v1', payload={…})
admin console ConnectorDetailComponent
  └─ ConnectorCallService.recentCalls(adapterId)
        └─ GET /audit/events?type=…&from=…&limit=200  (gateway proxy → audit-service)
              └─ client-side filter payload.adapterId === id → slice(0,20)
```

## Backward-compat / migration notes
- **No schema migration.** The per-tenant `events` table already exists; new rows just
  carry a new `type`. No DDL.
- **No contract break.** `IHttpCallResult.cacheResult` is optional/additive; existing
  `service-call.activity.ts` callers of `httpCallWithRetry` ignore it.
- **New env var** `NATS_URL` for `connector-runtime` (defaults to `nats://localhost:4222`).
  Must point at the platform NATS in deployed envs.
- **Historical calls** made before this ships produce no rows — the section is empty until
  new traffic flows. Acceptable (diagnostics, not audit-of-record).
- **Permission**: `diagnostics:read` must already be grantable (same one channel-detail uses).
