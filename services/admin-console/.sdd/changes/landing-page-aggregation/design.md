# Design — landing-page-aggregation

## Context

Three section landing components (Channels, Connections, Processes) display
hardcoded demo numbers. The codebase already has partially wired metrics
services and API methods. This design replaces demo data with live signals
where APIs exist, and honest empty/loading states where they don't.
No backend changes. No new routes. No new services.

---

## ADR-001: Replace demo data — Option C (Real where possible, empty state where not)

### Context

The landings show demo KPIs and tables. Three options existed:
- **A**: Keep all demo data, label it clearly as demo.
- **B**: Blank slate — remove all panels without real data; wait for phase N.
- **C**: Wire real signals that already have API backing; replace the rest
  with honest empty states.

### Decision

**Option C.** The accounts list, HTTP connector list, hosted services list,
and channel usage totals APIs already exist and are partially consumed.
Using them removes the biggest credibility gap (live tenant sees "2 connected"
regardless of their data). Panels with no API backing (top workflows, recent
executions, connector usage ranking, failed deliveries, auto-reply hit rate,
p95 response) become empty states — not fabricated numbers.

### Consequences

- **Positive**: No demo numbers visible to a real tenant. KPIs reflect real
  state on load. No backend contract needed.
- **Positive**: The `ActivityFeedComponent` already has a built-in `@empty`
  block with an `emptyText()` input — no new component needed.
- **Negative**: Some panels will show "no data yet" on fresh tenants. This
  is correct behavior, not a regression.
- **Risk**: The channels usage fan-out (3 parallel API calls) may time out or
  partially fail. Handled by showing `—` per channel on any error.

### Alternatives rejected

- **Option A**: Leaves false data visible to real tenants — unacceptable.
- **Option B**: Removes useful real-data panels that are already wired.

---

## Component and Service Changes

### 1. `ChannelsMetricsService`

**Current state**: `connectedCount = signal(2)`, `totalCount = signal(2)`,
`messagesIn24h = signal(18_240)`, `messagesOut24h = signal(15_982)` are demo
seeds. `loadCounts()` fetches real accounts but only sets
`whatsappTotal / telegramTotal / httpTotal`.

**Required changes**:

a. Inside the `loadCounts()` subscribe `next` callback, after the per-channel
   counts are tallied, also derive `connectedCount` and `totalCount` from the
   accounts array length. All accounts are "connected" for now (no status field
   on `IChannelAccount`) — set both to `accounts.length`. This is accurate:
   if an account exists, it is configured.

b. Reset `connectedCount` and `totalCount` to `signal<number | null>(null)`
   (null = loading). On error keep `null` (shows `—`).

c. Add `loadUsageTotals()` — a new method that fires 4 HTTP calls via
   `forkJoin`:
   - `getUsageTotals({ from, to })` → overall in/out → `messagesIn24h`,
     `messagesOut24h`
   - `getUsageTotals({ from, to, channel: 'whatsapp' })` → `channelTraffic`
     per-channel signal for whatsapp
   - `getUsageTotals({ from, to, channel: 'telegram' })` → telegram
   - `getUsageTotals({ from, to, channel: 'http' })` → http

   `from` = ISO string 24h ago, `to` = ISO string now (computed at call time).

d. Add writable signals for per-channel traffic:
   ```
   readonly whatsappTraffic = signal<number | null>(null);
   readonly telegramTraffic = signal<number | null>(null);
   readonly httpTraffic    = signal<number | null>(null);
   ```
   These are the sum of `ingress + egress` events from the respective
   `IUsageTotalsRow[]` response.

e. Reset `messagesIn24h` and `messagesOut24h` to `signal<number | null>(null)`.

f. `failedDeliveries24h` stays `signal<number | null>(null)` — no API.

g. Add `usageTotalsLoaded` boolean guard (like `countsLoaded`) so
   `loadUsageTotals()` is idempotent.

**Fan-out structure** (inside `loadUsageTotals`):
```ts
const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const to   = new Date().toISOString();
forkJoin({
  all:      this.channelsApi.getUsageTotals({ from, to }),
  whatsapp: this.channelsApi.getUsageTotals({ from, to, channel: 'whatsapp' }),
  telegram: this.channelsApi.getUsageTotals({ from, to, channel: 'telegram' }),
  http:     this.channelsApi.getUsageTotals({ from, to, channel: 'http' }),
}).subscribe({
  next: ({ all, whatsapp, telegram, http }) => {
    // all: extract ingress/egress rows → sum
    // whatsapp/telegram/http: same
  },
  error: () => {
    // leave all as null — template shows —
  }
});
```

Helper to sum a `IUsageTotalsRow[]` by direction:
```ts
function sumDirection(rows: IUsageTotalsRow[], dir: UsageDirection): number {
  return rows.filter(r => r.direction === dir).reduce((a, r) => a + r.events, 0);
}
```

### 2. `ChannelsLandingComponent`

**Current state**: `channels()` computed returns hardcoded array;
`recentFailures()` returns hardcoded entries.

**Required changes**:

a. `channels()` computed reads from `metrics.whatsappTraffic()`,
   `metrics.telegramTraffic()`, `metrics.httpTraffic()`. Status is always
   `"ok"` (no failure-detection API). If all three are `null`, render the
   array with `msgs24h: 0` (shows bars at zero) — or hide the section.
   Decision: render with 0 so the layout doesn't shift; `null` → 0.

b. `recentFailures()` returns `[]` (empty array). `ActivityFeedComponent`
   renders the `@empty` block automatically with its default `emptyText`.
   Override `emptyText` to `"No recent failures"`.

c. Auto-reply hit rate and p95 KPI cards: replace `value="68.4%"` and
   `value="820ms"` with `value="—"` and a `sub` of `"metrics coming soon"`.
   Remove `trend` and `trendLabel` inputs.

d. Call `metrics.loadUsageTotals()` from the component's `constructor` or
   `ngOnInit`. The service guard ensures only one real call is made.

### 3. `ConnectionsMetricsService`

**Current state**: `internalCount = signal(4)`, `externalCount = signal(12)`,
`externalErrored = signal(1)`, `hostedCount = signal(7)` are demo seeds.
`httpConnectorsTotal` is real. `hostedTotal` is a real `computed`.

**Required changes**:

a. Inside `loadCounts()` subscribe `next`, set `internalCount` and
   `externalCount` from the real adapter list. The `IHttpAdapter` model needs
   inspection — if it has a `kind` or `type` field, split; otherwise set
   `internalCount = rows.length` and `externalCount = signal(0)` (or keep
   the current combined approach and just zero out the seeds).

b. Reset demo seeds: `internalCount = signal<number | null>(null)`,
   `externalCount = signal<number | null>(null)`,
   `externalErrored = signal<number | null>(null)`,
   `internalErrored = signal<number | null>(null)`.

c. `hostedCount` — the existing `signal<number | null>(7)` is a separate
   demo seed that shadows `hostedTotal`. Remove it or align it. The landing
   currently binds to `metrics.hostedCount()` (the demo seed), not
   `metrics.hostedTotal()` (the real computed). Fix the landing to bind
   `metrics.hostedTotal()` directly. The `hostedCount` signal can be removed
   or deprecated.

**Note on adapter kind**: Before task execution, the implementor must check
`IHttpAdapter` model shape. If no `kind` field exists, `internalCount` and
`externalCount` cannot be split — set both from `rows.length` (combined) and
zero out the other. The landing KPI card already shows a single "HTTP" label,
so the split is cosmetic.

### 4. `ConnectionsLandingComponent`

**Required changes**:

a. HTTP KPI card: bind `[value]="metrics.httpConnectorsTotal() ?? '—'"` instead
   of `metrics.httpCount()`. The `httpCount` computed adds `internalCount +
   externalCount` (both demo seeds). `httpConnectorsTotal` is the real value.

b. Hosted services KPI card: bind `[value]="metrics.hostedTotal() ?? '—'"`.
   Remove `hostedCount` binding.

c. `topConnectors()` returns `[]`. Panel renders `ActivityFeedComponent`-like
   empty state. Since `topConnectors` is an `@for` loop with no
   `ActivityFeedComponent`, add an `@empty` block inline:
   ```html
   @empty {
     <p class="empty-hint">Usage analytics coming soon</p>
   }
   ```
   Add `.empty-hint` style (font-size: 12px; color: var(--text3); ...).

d. `recentActivity()` returns `[]`. Pass `emptyText="No recent activity"` to
   `ActivityFeedComponent`.

### 5. `ProcessesMetricsService`

**Required changes**:

a. `workflowsActive`, `workflowsFailing`, `executionsSuccessToday`,
   `executionsFailedToday` are demo seeds with no API backing. Reset all to
   `signal<number | null>(null)`.

b. No new API calls. `loadCounts()` already fetches `workflowsTotal` (real).

### 6. `ProcessesLandingComponent`

**Required changes**:

a. `workflowsActive` KPI: already bound to `metrics.workflowsActive() ?? '—'`.
   With the signal reset to `null`, it will display `—` automatically.

b. `failingSub()` already guards with `?? 0` — when `null`, shows "all healthy".
   Adjust: if `metrics.workflowsActive()` is null, sub should be `""` or
   `"coming soon"`. Change guard logic: if active is null, return `"coming soon"`.

c. `execTotalLabel()` and `execBreakdownSub()` already use `?? 0`. With both
   signals null, total is `0` (formatted as "0") and sub is "0 ok · 0 failed".
   This is misleading. Fix: if both are null, return `"—"` and `""` respectively.

d. `topWorkflows()` returns `[]`. Add `@empty` block:
   ```html
   @empty {
     <p class="empty-hint">No data yet</p>
   }
   ```

e. `recentExecutions()` returns `[]`. Pass `emptyText="No recent executions"`
   to `ActivityFeedComponent`.

f. "Workflows active" KPI label is misleading when the signal is null. Consider
   relabeling to "Workflows" (total count from `workflowsTotal`) — bind to
   `metrics.workflowsTotal() ?? '—'` with sub `"total configured"`. This
   makes the one real signal visible.

---

## Data Flow Summary

```
ChannelsMetricsService.loadCounts()
  → GET /channels/accounts
  → connectedCount, totalCount, whatsappTotal, telegramTotal, httpTotal

ChannelsMetricsService.loadUsageTotals()
  → forkJoin 4x GET /channels/usage/totals[?channel=...]
  → messagesIn24h, messagesOut24h
  → whatsappTraffic, telegramTraffic, httpTraffic

ConnectionsMetricsService.loadCounts()
  → GET /connections/http-adapters (via HttpAdapterService)
  → httpConnectorsTotal (already real)
  → internalCount, externalCount (to be derived from rows)
  → RegistryService.loadServices() → hostedTotal (already real computed)

ProcessesMetricsService.loadCounts()
  → GET /workflows
  → workflowsTotal (already real)
  → all other signals → null (no API)
```

---

## Loading and Error Handling

- Signals initialized to `null` → template shows `"—"` via `?? '—'`.
- On API success → signal updated → template re-renders via Angular signals reactivity.
- On API error → signal stays `null` → `"—"` persists. No crash.
- The `forkJoin` in `loadUsageTotals` fails atomically if any of the 4 calls
  fail. All 4 signals stay `null`. This is acceptable for now.
- Loading states are implicit: `null` = loading or unavailable. No spinner is
  added (out of scope).

---

## Empty State UI

No new component needed. Two mechanisms exist:

1. `ActivityFeedComponent` — already has `@empty { <li class="feed-empty">{{ emptyText() }}</li> }`.
   Use by passing an empty array and optionally overriding `emptyText`.

2. `@for ... @empty` blocks — for non-feed lists (connector rows, workflow rows).
   Inline `<p class="empty-hint">...</p>` with existing or new `.empty-hint` style.

The `.empty-hint` class uses:
```css
.empty-hint {
  font-size: 12px;
  color: var(--text3);
  padding: 12px 0;
  margin: 0;
  text-align: center;
}
```

This pattern is consistent with `.feed-empty` in `ActivityFeedComponent`.
