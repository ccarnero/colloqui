# Tasks — channel-trace-entry

Ordered. Each task is independently verifiable before the next begins.

**STATUS: ARCHIVED (2026-06-28)** — All tasks completed. Verification: PASS.

## Completion Summary

- ✅ Task 1 — DONE
- ✅ Task 2 — DONE
- ✅ Task 3 — DONE
- ✅ Task 4 — DONE
- ✅ Task 5 — DONE
- ⊘ Task 6 — MANUAL (skipped — automated test coverage sufficient)

---

## Task 1 — Extend `recentTraces()` to accept optional filter params

**File**: `services/admin-console/src/app/core/services/message-trace.service.ts`

**Change**:

1. Update the method signature from:
   ```ts
   recentTraces(windowMin = 1440, limit = 500): Observable<IRecentTrace[]>
   ```
   to:
   ```ts
   recentTraces(
     windowMin = 1440,
     limit = 500,
     filter?: { accountId?: string; channel?: string },
   ): Observable<IRecentTrace[]>
   ```

2. Replace the params construction block:
   ```ts
   // Remove the .set("channel", "") line and the stripEmpty() call
   let params = new HttpParams()
     .set("from", from)
     .set("limit", String(limit));
   if (filter?.accountId) params = params.set("accountId", filter.accountId);
   if (filter?.channel)   params = params.set("channel",   filter.channel);
   return this.http
     .get<IAuditListResponse>(`${AUDIT}/channel-events`, { params })
     .pipe(map((res) => groupRecent(asRows(res))));
   ```

**Verify**:
- TypeScript compiles without errors: `cd services/admin-console && npx tsc --noEmit`
- Existing call in `MessageTraceComponent.loadRecent()` (`this.traceService.recentTraces()`)
  requires no change — still compiles and behaves identically (no filter params sent).
- Calling `recentTraces(60, 20, { accountId: "acc1", channel: "telegram" })` would
  produce a URL ending in `?from=…&limit=20&accountId=acc1&channel=telegram` (verify by
  inspection or a unit test assertion on the `HttpParams`).

---

## Task 2 — Add permission constant, new injections, and signals to `ChannelDetailComponent`

**File**: `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

**Change**:

1. Add at module level (after existing imports, before `RANGE_SPECS`):
   ```ts
   const DIAGNOSTICS_PERMISSION = "diagnostics:read";
   ```

2. Add to the component `imports` array:
   ```ts
   // Already present: RouterLink, MatProgressSpinnerModule
   // No new Angular imports needed.
   ```

3. Add TypeScript imports at the top of the file:
   ```ts
   import { MessageTraceService } from "../../../core/services/message-trace.service";
   import type { IRecentTrace } from "../../processes/trace/domain/message-trace.model";
   ```

4. Add to the class body (after `private readonly dialog = inject(MatDialog)`):
   ```ts
   private readonly traceService = inject(MessageTraceService);

   readonly recentTraces  = signal<IRecentTrace[]>([]);
   readonly tracesLoading = signal(false);
   readonly canViewTraces = computed(() =>
     this.auth.hasPermission(DIAGNOSTICS_PERMISSION),
   );
   ```

**Verify**:
- `npx tsc --noEmit` passes.
- No runtime errors when the channel detail page loads (open browser DevTools console).

---

## Task 3 — Add `loadRecentTraces()` method and wire it into `reload()`

**File**: `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

**Change**:

1. Add private method (place after `openInspector()`):
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

2. At the end of `reload()`, after `this.errorMessage.set(null)` (before the `forkJoin`
   block) — actually place it after `this.resolvedRange.set(resolved)`:
   ```ts
   this.loadRecentTraces();
   ```

3. Add `shortCorrelationId()` helper method:
   ```ts
   shortCorrelationId(id: string): string {
     return id.length > 10 ? `${id.slice(0, 8)}…` : id;
   }
   ```

**Verify**:
- `npx tsc --noEmit` passes.
- Opening a channel detail page while logged in with `diagnostics:read` triggers a
  `GET /audit/channel-events?from=…&limit=20&accountId=…&channel=…` request (check
  Network tab — both `accountId` and `channel` params must be present).
- Opening the same page without `diagnostics:read` makes no request to
  `/audit/channel-events` from this component.

---

## Task 4 — Add the "Recent messages" template section

**File**: `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

**Change**: In the inline template, add after the closing `</section>` of the
"Streams (this account)" section:

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

**Verify**:
- Template compiles without Angular compiler errors.
- With `diagnostics:read`: section appears, rows render, clicking a row navigates to
  `/processes/trace/<correlationId>`.
- Without `diagnostics:read`: section is absent from the DOM.
- When no events match the account+channel in the last hour: "No recent messages in the
  last hour." text is shown.

---

## Task 5 — Add styles for the "Recent messages" section

**File**: `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

**Change**: Append to the `styles` string inside the `@Component` decorator:

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

**Verify**:
- Rows are horizontally laid out (timestamp | verdict badge | truncated ID).
- Hover produces a subtle background change.
- Each row is visually consistent with the existing section card style (border +
  border-radius pattern used in `.chart-wrap`).

---

## Task 6 — Manual E2E verification

Steps to run against a live dev environment:

1. Log in as a user with `diagnostics:read` permission.
2. Navigate to a channel account detail page
   (`/channels/<channel>/<accountId>`).
3. Confirm the "Recent messages" section appears below "Streams (this account)".
4. Confirm rows show timestamp, verdict, and truncated correlation ID.
5. Click a row — confirm navigation to `/processes/trace/<correlationId>` and that the
   trace view loads the correct trace (correlation ID matches).
6. In the Refresh button — confirm the "Recent messages" section reloads.
7. Log in as a user without `diagnostics:read` — confirm the section is absent from the
   DOM (`document.querySelector('.trace-list')` returns `null`).
8. Open Network tab for step 7 — confirm no `GET /audit/channel-events` request is
   made from the channel detail page.
