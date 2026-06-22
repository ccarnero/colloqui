# Design — channel-trace-entry

## Scope

Two files touched. No backend changes.

- `services/admin-console/src/app/core/services/message-trace.service.ts`
- `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

---

## 1. Service change — `message-trace.service.ts`

### Current signature

```ts
recentTraces(windowMin = 1440, limit = 500): Observable<IRecentTrace[]>
```

The current implementation unconditionally sets `channel: ""` in `HttpParams`, which
`stripEmpty()` removes before the request. `accountId` is never sent.

### New signature

```ts
recentTraces(
  windowMin = 1440,
  limit = 500,
  filter?: { accountId?: string; channel?: string },
): Observable<IRecentTrace[]>
```

Backward-compatible: existing callers (`MessageTraceComponent.loadRecent()`) pass no
arguments and continue to work unchanged.

### Implementation change

Replace the current params construction block:

```ts
// BEFORE
const params = new HttpParams()
  .set("channel", "")
  .set("from", from)
  .set("limit", String(limit));
return this.http
  .get<IAuditListResponse>(`${AUDIT}/channel-events`, {
    params: stripEmpty(params),
  })
  .pipe(map((res) => groupRecent(asRows(res))));
```

With:

```ts
// AFTER
let params = new HttpParams()
  .set("from", from)
  .set("limit", String(limit));
if (filter?.accountId) params = params.set("accountId", filter.accountId);
if (filter?.channel)   params = params.set("channel",   filter.channel);
return this.http
  .get<IAuditListResponse>(`${AUDIT}/channel-events`, { params })
  .pipe(map((res) => groupRecent(asRows(res))));
```

`stripEmpty()` is no longer needed in this method (but must stay — it's used nowhere
else visible, but removing it is out of scope here). The gateway DTO
(`QueryChannelEventsProxyDto`) already accepts `accountId?` and `channel?` as optional
string filters. No backend change required.

---

## 2. Component change — `channel-detail.component.ts`

All markup and logic is inline in the single component file (no separate `.html`).

### 2.1 New imports

```ts
import { MessageTraceService } from "../../../core/services/message-trace.service";
import type { IRecentTrace } from "../../processes/trace/domain/message-trace.model";
```

`RouterLink` and `MatProgressSpinnerModule` are already imported.

### 2.2 Permission constant

Add at the module level (same pattern as `MessageTraceComponent`):

```ts
const DIAGNOSTICS_PERMISSION = "diagnostics:read";
```

### 2.3 New injections and signals

```ts
private readonly traceService = inject(MessageTraceService);

readonly recentTraces    = signal<IRecentTrace[]>([]);
readonly tracesLoading   = signal(false);
readonly canViewTraces   = computed(() =>
  this.auth.hasPermission(DIAGNOSTICS_PERMISSION),
);
```

`auth` is already injected as `private readonly auth = inject(AuthService)`.

### 2.4 New method `loadRecentTraces()`

```ts
private loadRecentTraces(): void {
  if (!this.canViewTraces()) return;
  const accountId = this.accountId();
  const channel   = this.channel();
  if (!accountId || !channel) return;

  this.tracesLoading.set(true);
  this.traceService
    .recentTraces(60, 20, { accountId, channel })
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next:  (rows) => { this.recentTraces.set(rows); this.tracesLoading.set(false); },
      error: ()     => { this.recentTraces.set([]);   this.tracesLoading.set(false); },
    });
}
```

Window is 60 min (last hour, not last 24 h) and limit is 20 — sufficient for a
diagnostic sidebar; avoids pulling 500 rows for the full global view.

### 2.5 Wire into `reload()`

At the end of the existing `reload()` method, after `this.resolvedRange.set(resolved)`,
add:

```ts
this.loadRecentTraces();
```

This means traces refresh on every range change and on manual Refresh — intentional, as
the account/channel may have new activity.

### 2.6 Helper method `shortCorrelationId()`

```ts
shortCorrelationId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
```

### 2.7 Template section

Place after the closing `</section>` of the "Streams" section and before the closing of
the root div:

```html
@if (canViewTraces()) {
  <section class="section">
    <h3 class="section-title">Recent messages</h3>
    @if (tracesLoading()) {
      <div class="loader">
        <mat-spinner diameter="24"></mat-spinner>
        <span>Loading recent messages…</span>
      </div>
    } @else if (recentTraces().length === 0) {
      <p class="no-traces">No recent messages in the last hour.</p>
    } @else {
      <div class="trace-list">
        @for (t of recentTraces(); track t.correlationId) {
          <a class="trace-row"
             [routerLink]="['/processes/trace', t.correlationId]">
            <span class="trace-ts">{{ t.lastAt }}</span>
            <span class="trace-verdict">{{ t.verdict }}</span>
            <span class="trace-id">{{ shortCorrelationId(t.correlationId) }}</span>
          </a>
        }
      </div>
    }
  </section>
}
```

Each row is an `<a>` with `[routerLink]` — no imperative navigation needed. Deep-link
target is `/processes/trace/:correlationId` (confirmed in `app.routes.ts` lines 244-249).

### 2.8 New styles

Append to the existing `styles` array in the component decorator:

```css
.no-traces {
  color: var(--text3);
  font-size: 13px;
  margin: 0;
}
.trace-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trace-row {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  text-decoration: none;
  color: var(--text);
  font-size: 13px;
}
.trace-row:hover {
  background: var(--bg2);
}
.trace-ts {
  color: var(--text3);
  font-size: 12px;
  min-width: 190px;
  font-family: var(--font-mono, monospace);
}
.trace-verdict {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 6px;
  background: var(--bg2);
  white-space: nowrap;
}
.trace-id {
  font-family: var(--font-mono, monospace);
  color: var(--text3);
  font-size: 12px;
}
```

---

## 3. Permission gate behavior

The section is wrapped in `@if (canViewTraces())`. When the user lacks
`diagnostics:read`:

- The section is absent from the DOM — no error, no spinner, no empty state.
- `loadRecentTraces()` returns early without making any HTTP request.

This mirrors how `MessageTraceComponent` itself handles missing permission (the entire
body is hidden; the component doesn't throw or show an error banner).

---

## 4. Data flow

```
ngOnInit → route.paramMap → channel.set / accountId.set → reload()
                                                             └─ loadRecentTraces()
                                                                  └─ canViewTraces() guard
                                                                  └─ traceService.recentTraces(60, 20, { accountId, channel })
                                                                       └─ GET /audit/channel-events?from=…&limit=20&accountId=…&channel=…
                                                                            └─ groupRecent() → IRecentTrace[]
                                                                            └─ recentTraces.set(rows) → @for renders trace-row anchors
```

---

## 5. Visual placement

```
[breadcrumb]
[page-header]
[error-banner?]

section: Totals (KPI cards)
section: Activity over time (chart)
section: Streams (this account)
section: Recent messages          ← NEW (only when diagnostics:read)
```
