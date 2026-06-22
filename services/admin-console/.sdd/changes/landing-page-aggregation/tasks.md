# Tasks — landing-page-aggregation

Ordered for sequential apply. Each task touches at most one file.
Dependencies are noted. All tasks are independently verifiable.

---

## Task 1 — Reset demo seeds in `ChannelsMetricsService` ✅

**File**: `src/app/core/services/metrics/channels-metrics.service.ts`

Change:
- `connectedCount = signal<number | null>(2)` → `signal<number | null>(null)`
- `totalCount = signal<number | null>(2)` → `signal<number | null>(null)`
- `messagesIn24h = signal<number | null>(18_240)` → `signal<number | null>(null)`
- `messagesOut24h = signal<number | null>(15_982)` → `signal<number | null>(null)`
- Add three new writable signals after the existing per-channel totals:
  ```ts
  readonly whatsappTraffic = signal<number | null>(null);
  readonly telegramTraffic = signal<number | null>(null);
  readonly httpTraffic     = signal<number | null>(null);
  ```
- `failedDeliveries24h` stays `signal<number | null>(null)` — already correct if it was null, otherwise reset it.

**Acceptance**: `connectedCount()` and `totalCount()` return `null` before any load call. Template shows `—/—` on first render.

---

## Task 2 — Wire `connectedCount`/`totalCount` from real account list ✅

**File**: `src/app/core/services/metrics/channels-metrics.service.ts`

Inside `loadCounts()` subscribe `next` callback (after the per-channel tally loop), add:
```ts
this.connectedCount.set(accounts.length);
this.totalCount.set(accounts.length);
```
Inside `error` callback, add:
```ts
this.connectedCount.set(null);
this.totalCount.set(null);
```

**Acceptance**: After `loadCounts()` resolves, `connectedCount()` equals actual number of channel accounts returned by the API.

---

## Task 3 — Add `loadUsageTotals()` to `ChannelsMetricsService` ✅

**File**: `src/app/core/services/metrics/channels-metrics.service.ts`

Add import: `forkJoin` from `rxjs`, `UsageDirection`, `IUsageTotalsRow` from the model.

Add a private `usageTotalsLoaded = false` guard field.

Add a private helper before the class closing brace (or as a module-level function):
```ts
function sumEvents(rows: IUsageTotalsRow[], direction: UsageDirection): number {
  return rows.filter(r => r.direction === direction).reduce((a, r) => a + r.events, 0);
}
```

Add method `loadUsageTotals()`:
```ts
loadUsageTotals(): void {
  if (this.usageTotalsLoaded) return;
  this.usageTotalsLoaded = true;
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to   = new Date().toISOString();
  forkJoin({
    all:      this.channelsApi.getUsageTotals({ from, to }),
    whatsapp: this.channelsApi.getUsageTotals({ from, to, channel: 'whatsapp' }),
    telegram: this.channelsApi.getUsageTotals({ from, to, channel: 'telegram' }),
    http:     this.channelsApi.getUsageTotals({ from, to, channel: 'http' }),
  }).subscribe({
    next: ({ all, whatsapp, telegram, http }) => {
      this.messagesIn24h.set(sumEvents(all.items, 'ingress'));
      this.messagesOut24h.set(sumEvents(all.items, 'egress'));
      this.whatsappTraffic.set(sumEvents(whatsapp.items, 'ingress') + sumEvents(whatsapp.items, 'egress'));
      this.telegramTraffic.set(sumEvents(telegram.items, 'ingress') + sumEvents(telegram.items, 'egress'));
      this.httpTraffic.set(sumEvents(http.items, 'ingress') + sumEvents(http.items, 'egress'));
    },
    error: () => {
      // leave all as null — template shows —
    },
  });
}
```

Also add `this.usageTotalsLoaded = false; this.loadUsageTotals();` inside `reload()`.

**Acceptance**: Calling `loadUsageTotals()` twice only fires 4 HTTP requests (guard works). On success, `messagesIn24h()` is a non-null number. On error, all 5 signals remain `null`.

---

## Task 4 — Wire `channels()` computed and update Channels landing KPI cards ✅

**File**: `src/app/features/channels/channels-landing.component.ts`

Changes:

a. Replace the hardcoded `channels()` computed:
```ts
protected readonly channels = computed<IChannelStatus[]>(() => [
  { name: 'WhatsApp', slug: 'whatsapp', status: 'ok', msgs24h: this.metrics.whatsappTraffic() ?? 0 },
  { name: 'Telegram', slug: 'telegram', status: 'ok', msgs24h: this.metrics.telegramTraffic() ?? 0 },
  { name: 'HTTP',     slug: 'http',     status: 'ok', msgs24h: this.metrics.httpTraffic()     ?? 0 },
]);
```

b. Replace the hardcoded Auto-reply hit rate KPI card:
```html
<app-kpi-card
  label="Auto-reply hit rate"
  value="—"
  sub="metrics coming soon"
/>
```

c. Replace the hardcoded p95 response KPI card:
```html
<app-kpi-card
  label="p95 response"
  value="—"
  sub="metrics coming soon"
/>
```

d. Replace the hardcoded `recentFailures()` computed:
```ts
protected readonly recentFailures = computed<IActivityEntry[]>(() => []);
```

e. Pass `emptyText` to `ActivityFeedComponent` in the template:
```html
<app-activity-feed [entries]="recentFailures()" emptyText="No recent failures" />
```

f. Call `metrics.loadUsageTotals()` in constructor (after `metrics.loadCounts()` if it's already called, or rely on the parent shell — confirm where `loadCounts()` is triggered and add `loadUsageTotals()` in the same location, i.e., the component constructor or ngOnInit).

**Acceptance**: Template shows `—` for hit-rate and p95. `channels()` shows real numbers when API resolves. "Recent failed deliveries" panel shows "No recent failures" text (from `ActivityFeedComponent` empty state).

---

## Task 5 — Reset demo seeds in `ConnectionsMetricsService` ✅

**File**: `src/app/core/services/metrics/connections-metrics.service.ts`

Changes:
- `internalCount = signal<number | null>(4)` → `signal<number | null>(null)`
- `externalCount = signal<number | null>(12)` → `signal<number | null>(null)`
- `externalErrored = signal<number | null>(1)` → `signal<number | null>(null)`
- `internalErrored = signal<number | null>(0)` → `signal<number | null>(null)`
- `hostedCount = signal<number | null>(7)` → `signal<number | null>(null)` (this signal is superseded by `hostedTotal` computed — null is safe and the landing will stop using it in Task 6)

Inside `loadCounts()` subscribe `next` callback, set `internalCount` from the real row count (no kind field on `IAdapterDto`, so all adapters are "HTTP" — set `internalCount = rows.length` and `externalCount = 0`):
```ts
next: (rows) => {
  this.httpConnectorsTotal.set(rows.length);
  this.internalCount.set(rows.length);
  this.externalCount.set(0);
},
error: () => {
  this.httpConnectorsTotal.set(null);
  this.internalCount.set(null);
  this.externalCount.set(null);
},
```

**Acceptance**: `httpConnectorsTotal()` equals `internalCount()` (same rows). `externalCount()` is `0`. `externalErrored()` and `internalErrored()` are `null`.

---

## Task 6 — Wire Connections landing KPI cards and empty panels ✅

**File**: `src/app/features/connections/connections-landing.component.ts`

Changes:

a. HTTP KPI card: change binding from `metrics.httpCount()` to `metrics.httpConnectorsTotal()`:
```html
<app-kpi-card
  label="HTTP"
  [value]="metrics.httpConnectorsTotal() ?? '—'"
  [sub]="httpSub()"
/>
```

b. Hosted services KPI card: change binding from `metrics.hostedCount()` to `metrics.hostedTotal()`:
```html
<app-kpi-card
  label="Hosted services"
  [value]="metrics.hostedTotal() ?? '—'"
  sub="all healthy"
/>
```

c. Replace hardcoded `topConnectors()` computed:
```ts
protected readonly topConnectors = computed<ITopConnector[]>(() => []);
```

d. Add `@empty` block to the `@for` loop in the template:
```html
@for (c of topConnectors(); track c.name) {
  ...
} @empty {
  <p class="empty-hint">Usage analytics coming soon</p>
}
```

e. Add `.empty-hint` style in the component's `styles`:
```css
.empty-hint {
  font-size: 12px;
  color: var(--text3);
  padding: 12px 0;
  margin: 0;
  text-align: center;
}
```

f. Replace hardcoded `recentActivity()` computed:
```ts
protected readonly recentActivity = computed<IActivityEntry[]>(() => []);
```

g. Pass `emptyText` to `ActivityFeedComponent`:
```html
<app-activity-feed [entries]="recentActivity()" emptyText="No recent activity" />
```

**Acceptance**: HTTP KPI shows real adapter count. Hosted KPI shows real services count. "Most-used connectors" panel shows "Usage analytics coming soon". "Recent activity" panel shows "No recent activity".

---

## Task 7 — Reset demo seeds in `ProcessesMetricsService` ✅

**File**: `src/app/core/services/metrics/processes-metrics.service.ts`

Changes:
- `workflowsActive = signal<number | null>(28)` → `signal<number | null>(null)`
- `workflowsFailing = signal<number | null>(3)` → `signal<number | null>(null)`
- `executionsSuccessToday = signal<number | null>(4_812)` → `signal<number | null>(null)`
- `executionsFailedToday = signal<number | null>(64)` → `signal<number | null>(null)`

**Acceptance**: `workflowsActive()` returns `null` on fresh service instance.

---

## Task 8 — Fix Processes landing computed guards and empty panels ✅

**File**: `src/app/features/processes/processes-landing.component.ts`

Changes:

a. First KPI card: change label to "Workflows" and bind to `workflowsTotal` (the real signal):
```html
<app-kpi-card
  label="Workflows"
  [value]="metrics.workflowsTotal() ?? '—'"
  sub="total configured"
/>
```
Remove the `[sub]="failingSub()"` binding (it relied on demo `workflowsFailing`). The `failingSub()` computed can be removed or kept for later; remove it now to avoid dead code.

b. Executions KPI card — fix `execTotalLabel()` to return `"—"` when both signals are null:
```ts
protected readonly execTotalLabel = computed(() => {
  const s = this.metrics.executionsSuccessToday();
  const f = this.metrics.executionsFailedToday();
  if (s === null && f === null) return '—';
  return this.formatNum((s ?? 0) + (f ?? 0));
});
```

c. Fix `execBreakdownSub()` to return `""` when both signals are null:
```ts
protected readonly execBreakdownSub = computed(() => {
  const s = this.metrics.executionsSuccessToday();
  const f = this.metrics.executionsFailedToday();
  if (s === null && f === null) return '';
  return `${this.formatNum(s ?? 0)} ok · ${f ?? 0} failed`;
});
```

d. Remove `workflowsActive` and `workflowsFailing` KPI card (the second card that was "Workflows active"). Replace with a simple "Services" card already present — confirm the third KPI card reads `value="up" sub="all healthy"` and leave it.

   Alternatively: if the layout requires 3 KPI cards, the third "Services" card already exists. Just remove the now-null "Workflows active" card and leave "Executions today" + "Services". Confirm count of KPI cards before removing.

e. Replace hardcoded `topWorkflows()`:
```ts
protected readonly topWorkflows = computed<ITopWorkflow[]>(() => []);
```

f. Add `@empty` block to the `@for` loop:
```html
@for (w of topWorkflows(); track w.id) {
  ...
} @empty {
  <p class="empty-hint">No data yet</p>
}
```

g. Add `.empty-hint` style (same as Connections landing).

h. Replace hardcoded `recentExecutions()`:
```ts
protected readonly recentExecutions = computed<IActivityEntry[]>(() => []);
```

i. Pass `emptyText` to `ActivityFeedComponent`:
```html
<app-activity-feed [entries]="recentExecutions()" emptyText="No recent executions" />
```

j. Remove `failingSub()` computed if it is no longer referenced in the template.

**Acceptance**: Processes landing shows `workflowsTotal` real count. Execution KPI shows `—` when signals are null. "Top workflows" shows "No data yet". "Recent executions" shows "No recent executions".

---

## Task 9 — Verify no broken references from removed/renamed signals ✅

**File**: All three metrics services and their consumers.

Search for references to removed or now-null signals:
- `workflowsActive` — referenced in `resolve()` switch and landing; confirm landing no longer reads it.
- `hostedCount` — referenced in `resolve()` switch; landing must not reference it anymore.
- `httpCount` — still in `resolve()` and used indirectly (keep it, `httpErrored` depends on `internalCount` and `externalCount`).

Remove unused computed `failingSub()` from `ProcessesLandingComponent` if not referenced.

**Acceptance**: `ng build` (or `tsc --noEmit`) produces zero errors. No dead computed references.

---

## Task 10 — Confirm `loadCounts()` and `loadUsageTotals()` are called on navigation

**File**: Check where `loadCounts()` is currently triggered for each landing. Most likely in the landing component constructor or in a route guard.

If `ChannelsLandingComponent` already calls `metrics.loadCounts()` in constructor — add `metrics.loadUsageTotals()` immediately after.

If it is triggered elsewhere (e.g., a shell or resolver), add the call in the same place.

**Acceptance**: Opening the Channels landing in the browser triggers exactly 5 network calls to the channels API (1 accounts + 4 usage totals). Signals update reactively.

---

## Delivery notes

- Tasks 1–3 are service-only changes, safe to apply in isolation.
- Tasks 4, 6, 8 are template + component changes, depend on prior tasks.
- Task 9 is a verification sweep, run after all prior tasks.
- Task 10 is a runtime smoke test, not a code change unless a call site is missing.
- No migrations. No schema changes. No backward-compat concerns (all changes are UI-layer).
- The `forkJoin` fan-out (Task 3) is the highest-risk change. If any of the 4 usage calls returns a non-200, the entire `forkJoin` errors and all traffic signals stay `null`. This is acceptable. A future improvement could use `forkJoin` with individual error recovery via `catchError(() => of({ items: [] }))` per inner observable.
