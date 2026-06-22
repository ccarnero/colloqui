# Tasks: Connector Recent Calls — HTTP Exchange Detail

Tasks are ordered by dependency. Each task is independently verifiable before the next begins.

---

## T1 — Header redaction and body truncation utilities + unit tests

**Files to create:**
- `services/connector-runtime/src/activities/_shared/redact-headers.ts`
- `services/connector-runtime/src/activities/_shared/truncate-body.ts`
- `services/connector-runtime/test/unit/redact-headers.spec.ts`
- `services/connector-runtime/test/unit/truncate-body.spec.ts`

**Specification:**

`redactHeaders(headers: Record<string, string>): Record<string, string>`
- For each header, lowercase the name for comparison only (preserve original case in output key)
- Redact (replace value with `"[REDACTED]"`) if lowercased name:
  - Is exactly one of: `authorization`, `x-api-key`, `x-api-secret`, `cookie`, `set-cookie`
  - Or contains any of: `token`, `secret`, `key`, `auth`
- Non-sensitive headers pass through unchanged
- Empty input returns empty object

`truncateBody(body: unknown): string | undefined`
- Returns `undefined` if `body` is `undefined` or `null`
- Serializes to string: if `typeof body === "string"` use as-is, otherwise `JSON.stringify(body)`
- Slices to 8192 characters if longer
- Returns the resulting string

**Test cases for `redactHeaders`:**
- `{ Authorization: "Bearer tok" }` → `{ Authorization: "[REDACTED]" }`
- `{ "x-api-key": "abc" }` → `{ "x-api-key": "[REDACTED]" }`
- `{ "X-Custom-Token": "t" }` → `{ "X-Custom-Token": "[REDACTED]" }` (contains "token")
- `{ "content-type": "application/json" }` → passes through unchanged
- `{ cookie: "session=x" }` → `{ cookie: "[REDACTED]" }`
- Mixed object with both sensitive and non-sensitive headers → correct output for each
- Empty object → empty object

**Test cases for `truncateBody`:**
- `undefined` → `undefined`
- `null` → `undefined`
- `"hello"` → `"hello"`
- `{ a: 1 }` → `'{"a":1}'`
- String of 8193 chars → sliced to 8192
- Object that serializes to 9000 chars → sliced to 8192

**Acceptance check:**
```bash
cd services/connector-runtime && bun test test/unit/redact-headers.spec.ts test/unit/truncate-body.spec.ts
```
All tests pass. No TypeScript errors (`bun tsc --noEmit`).

---

## T2 — Extend IEndpointCallEvent and update event-publisher.ts + tests

**Files to modify:**
- `services/connector-runtime/src/activities/_shared/event-publisher.ts`

**Changes:**

1. Add optional fields to `IEndpointCallEvent`:
   ```typescript
   readonly requestHeaders?: Record<string, string>;
   readonly requestBody?: string;
   readonly responseHeaders?: Record<string, string>;
   readonly responseBody?: string;
   readonly cacheKey?: string;
   readonly cacheTtlSeconds?: number;
   ```

2. In `emit()`, include new fields in the payload object when present:
   ```typescript
   ...(evt.requestHeaders !== undefined && { requestHeaders: evt.requestHeaders }),
   ...(evt.requestBody !== undefined && { requestBody: evt.requestBody }),
   ...(evt.responseHeaders !== undefined && { responseHeaders: evt.responseHeaders }),
   ...(evt.responseBody !== undefined && { responseBody: evt.responseBody }),
   ...(evt.cacheKey !== undefined && { cacheKey: evt.cacheKey }),
   ...(evt.cacheTtlSeconds !== undefined && { cacheTtlSeconds: evt.cacheTtlSeconds }),
   ```

3. Change `MAX_URL_LEN` from `120` to `2048`.

**File to update:**
- `services/connector-runtime/test/unit/event-publisher.spec.ts`

**Test changes:**
- Update `"truncates resolvedUrl longer than 120 chars"`:
  - Change `longUrl` to be `"https://api.example.com/" + "x".repeat(2048)` (length > 2048)
  - Assert `url.length === 2049` (2048 chars + ellipsis) and `url.endsWith("…")`
- Add test: `"includes requestHeaders in payload when provided"` — assert `p["requestHeaders"]` equals the provided object
- Add test: `"includes requestBody in payload when provided"` — assert `p["requestBody"]` equals the provided string
- Add test: `"omits optional fields from payload when undefined"` — assert `p` does not have keys `requestHeaders`, `requestBody`, etc. when not provided
- Add test: `"includes cacheKey and cacheTtlSeconds when provided"`

**Acceptance check:**
```bash
cd services/connector-runtime && bun test test/unit/event-publisher.spec.ts
```
All tests pass. No TypeScript errors.

---

## T3 — Wire new fields in endpoint-call.activity.ts

**Files to modify:**
- `services/connector-runtime/src/activities/endpoint-call.activity.ts`

**Changes:**

1. Import `redactHeaders` from `"./_shared/redact-headers"` and `truncateBody` from `"./_shared/truncate-body"`.

2. In `executeWithAdapterEndpoint`: extend the `publishEndpointCallEvent` call (lines 154-163) to include:
   ```typescript
   requestHeaders: redactHeaders(mergedHeaders),
   requestBody: truncateBody(body),
   responseHeaders: redactHeaders(result.headers),
   responseBody: truncateBody(result.data),
   cacheKey: decision.policy?.key,
   cacheTtlSeconds: decision.policy?.ttlSeconds,
   ```

3. In `executeWithAdapterBase`: apply the same extension to its `publishEndpointCallEvent` call (lines 231-240). Note `decision` is also in scope here.

4. `executeRaw` does not call `publishEndpointCallEvent` — leave untouched.

**Acceptance check:**

TypeScript compiles without errors:
```bash
cd services/connector-runtime && bun tsc --noEmit
```

Smoke check: run the existing endpoint-call unit tests if any exist, plus the event-publisher tests to confirm the interface aligns:
```bash
cd services/connector-runtime && bun test
```

Additionally, verify manually (or via integration test if available) that a test endpoint call emits a NATS event whose payload contains `requestHeaders` with sensitive values replaced by `[REDACTED]`.

---

## T4 — Extend IConnectorCall and toCall() mapping

**Files to modify:**
- `services/admin-console/src/app/core/services/connector-call.service.ts`

**Changes:**

1. Add to `IConnectorCall`:
   ```typescript
   readonly requestHeaders?: Record<string, string>;
   readonly requestBody?: unknown;
   readonly responseHeaders?: Record<string, string>;
   readonly responseBody?: unknown;
   readonly cacheKey?: string;
   readonly cacheTtlSeconds?: number;
   ```

2. Add helper functions at the bottom of the file:
   ```typescript
   function parseBodyField(v: unknown): unknown {
     if (typeof v !== "string") return undefined;
     try { return JSON.parse(v); } catch { return v; }
   }

   function recordField(v: unknown): Record<string, string> | undefined {
     return v !== null && typeof v === "object" && !Array.isArray(v)
       ? (v as Record<string, string>)
       : undefined;
   }
   ```

3. In `toCall()`, add to the returned object:
   ```typescript
   requestHeaders: recordField(payload["requestHeaders"]),
   requestBody: parseBodyField(payload["requestBody"]),
   responseHeaders: recordField(payload["responseHeaders"]),
   responseBody: parseBodyField(payload["responseBody"]),
   cacheKey: str(payload["cacheKey"]) || undefined,
   cacheTtlSeconds: typeof payload["cacheTtlSeconds"] === "number"
     ? payload["cacheTtlSeconds"]
     : undefined,
   ```

**Acceptance check:**

If a spec file exists for this service, update it and run it. Otherwise verify TypeScript compilation:
```bash
cd services/admin-console && npx tsc --noEmit
```

If `connector-call.service.spec.ts` exists:
```bash
cd services/admin-console && npx ng test --include="**/connector-call.service.spec.ts" --watch=false
```

Verify: a row with `payload.requestHeaders = { "content-type": "application/json", "authorization": "[REDACTED]" }` maps correctly to `c.requestHeaders` with both keys present. A row without `requestHeaders` in payload maps to `c.requestHeaders === undefined`.

---

## T5 — Expand-in-place UI in connector-detail.component.ts

**Files to modify:**
- `services/admin-console/src/app/features/data-integrations/connectors/detail/connector-detail.component.ts`

**Changes:**

1. Add `JsonPipe` to the `imports` array (already available as Angular built-in).

2. Add signal and methods to the component class:
   ```typescript
   readonly expandedIdx = signal<number | null>(null);

   protected toggleExpand(idx: number): void {
     this.expandedIdx.update((cur) => (cur === idx ? null : idx));
   }

   protected formatHeaders(headers: Record<string, string> | undefined): string {
     if (!headers) return "";
     return Object.entries(headers)
       .map(([k, v]) => `${k}: ${v}`)
       .join("\n");
   }

   protected formatBody(body: unknown): string {
     if (body === undefined || body === null) return "";
     if (typeof body === "string") return body;
     return JSON.stringify(body, null, 2);
   }
   ```

3. Replace the "Recent calls" `@for` block template:
   - Remove the conditional `<a>` / `<div>` / `ng-template #callCols` pattern
   - Replace with a single `<div role="button">` per row that:
     - Shows summary columns (same content as current)
     - Adds a chevron column (`▲` / `▼`) at the end
     - On click calls `toggleExpand(idx)`
     - When `expandedIdx() === idx` renders a `.call-detail` panel below the summary columns spanning all grid columns
   - The expanded panel contains:
     - **Request section:** full URL in `<pre>`, request headers formatted with `formatHeaders()`, request body with `formatBody()` (only if present)
     - **Response section:** response headers with `formatHeaders()`, response body with `formatBody()` (only if present)
     - **Cache section** (only when `hasCacheConfig() && c.cacheResult`): result badge, cache key in `<pre>` (if present), TTL (if present)
     - **Trace link** (only when `c.correlationId`): `<a [routerLink]="['/processes/trace', c.correlationId]">View trace</a>` with `mat-icon open_in_new`
   - Click inside the expanded panel must stop propagation to prevent toggling closed

4. Update `.call-row` CSS grid from:
   ```css
   grid-template-columns: 160px 60px 50px 70px 1fr auto;
   ```
   to:
   ```css
   grid-template-columns: 160px 60px 50px 70px 1fr auto auto;
   ```

5. Add CSS for new elements: `.call-detail`, `.detail-section`, `.detail-row`, `.detail-sub`, `.detail-pre`, `.expand-chevron`, `.trace-link`, `.detail-trace`.

**Acceptance check:**

TypeScript compilation:
```bash
cd services/admin-console && npx tsc --noEmit
```

Visual verification:
1. Navigate to a connector detail page with recent calls in the last hour.
2. Clicking a row expands it in place; clicking again collapses it.
3. Only one row is expanded at a time (clicking a different row collapses the previous one).
4. The expanded panel shows request headers (with `[REDACTED]` for secrets), request body, response headers, response body, and cache info when applicable.
5. The trace link in the expanded panel navigates correctly to the trace page.
6. Rows without `correlationId` have no trace link (no error in panel).
7. Rows from old events (without new fields) expand cleanly showing only available data (no blank sections, no errors).
8. Keyboard: Tab to a row, press Enter or Space to expand/collapse.

Unit test (if spec exists):
```bash
cd services/admin-console && npx ng test --include="**/connector-detail.component.spec.ts" --watch=false
```

---

## Migration Notes

- No schema changes. New NATS payload fields are additive.
- No database migrations. The audit-service stores the payload as a JSON column; new fields are simply present on new rows and absent on historical rows.
- Backward compatibility: all new fields on `IConnectorCall` are optional. The frontend handles `undefined` gracefully via `@if` guards in the template.
- The URL cap change (120 → 2048) affects only new events. Stored events with truncated URLs are unaffected.
- Deployment order: backend (T1–T3) can deploy independently. Frontend (T4–T5) can deploy before or after — new fields simply won't appear until the backend change is deployed.
