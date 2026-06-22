# Design: Connector Recent Calls — HTTP Request/Response Detail

## Overview

Expand the connector-runtime event publisher to capture the full HTTP exchange (redacted request headers/body, response headers/body, cache key/TTL) and surface it in the admin-console connector detail page via an expand-in-place accordion row.

---

## Components and Data Flow

```
endpoint-call.activity.ts
  ├── redactHeaders(mergedHeaders)        → requestHeaders
  ├── truncateBody(body)                  → requestBody
  ├── redactHeaders(result.headers)       → responseHeaders
  ├── truncateBody(result.data)           → responseBody
  ├── decision.policy?.key               → cacheKey
  └── decision.policy?.ttlSeconds        → cacheTtlSeconds
        │
        ▼
  publishEndpointCallEvent(IEndpointCallEvent)
        │
        ▼
  event-publisher.ts → emit() → NATS JetStream envelope
        │
        ▼
  audit-service stores as row.payload (JSON string)
        │
        ▼
  connector-call.service.ts → toCall() → IConnectorCall
        │
        ▼
  connector-detail.component.ts → expanded panel
```

---

## Interface Changes

### Backend: IEndpointCallEvent (event-publisher.ts)

```typescript
export interface IEndpointCallEvent {
  readonly tenantId: string;
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly method: string;
  readonly resolvedUrl: string;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: EndpointCacheResult;
  // New optional fields — absent when raw branch is used
  readonly requestHeaders?: Record<string, string>;
  readonly requestBody?: string;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: string;
  readonly cacheKey?: string;
  readonly cacheTtlSeconds?: number;
}
```

`requestBody` and `responseBody` are always strings: serialized JSON (or raw text) pre-truncated to 8 KB. Keeping them as `string` instead of `unknown` avoids double-serialization into the NATS payload and lets the frontend parse-or-display without ambiguity.

The `emit()` function passes these fields through unchanged into the payload object. No transformation needed beyond what happened upstream.

### URL cap

`MAX_URL_LEN` in `event-publisher.ts` is raised from 120 to 2048. The existing unit test that asserts truncation at 120 chars must be updated to reflect 2048.

### Backend: new utility files

**`services/connector-runtime/src/activities/_shared/redact-headers.ts`**

```typescript
const EXACT_REDACT = new Set([
  "authorization", "x-api-key", "x-api-secret", "cookie", "set-cookie",
]);
const CONTAINS_REDACT = ["token", "secret", "key", "auth"];
const REDACTED = "[REDACTED]";

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    const sensitive =
      EXACT_REDACT.has(lower) ||
      CONTAINS_REDACT.some((fragment) => lower.includes(fragment));
    result[name] = sensitive ? REDACTED : value;
  }
  return result;
}
```

**`services/connector-runtime/src/activities/_shared/truncate-body.ts`**

```typescript
const MAX_BODY_BYTES = 8192;

export function truncateBody(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;
}
```

### Backend: endpoint-call.activity.ts

Both `executeWithAdapterEndpoint` and `executeWithAdapterBase` already have in scope after the `httpCallWithRetry` call:
- `mergedHeaders` — request headers (already built)
- `body` — request body string from `applyJsonBody()`
- `result.headers` — response headers
- `result.data` — response body (parsed object or string)
- `decision.policy` — `IHttpResponseCachePolicy | null`

Each `publishEndpointCallEvent` call is extended with:

```typescript
publishEndpointCallEvent({
  // ... existing fields ...
  requestHeaders: redactHeaders(mergedHeaders),
  requestBody: truncateBody(body),
  responseHeaders: redactHeaders(result.headers),
  responseBody: truncateBody(result.data),
  cacheKey: decision.policy?.key,
  cacheTtlSeconds: decision.policy?.ttlSeconds,
});
```

The `executeRaw` branch does NOT call `publishEndpointCallEvent`, so it is unaffected.

### Frontend: IConnectorCall (connector-call.service.ts)

```typescript
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
  // New optional fields
  readonly requestHeaders?: Record<string, string>;
  readonly requestBody?: unknown;
  readonly responseHeaders?: Record<string, string>;
  readonly responseBody?: unknown;
  readonly cacheKey?: string;
  readonly cacheTtlSeconds?: number;
}
```

`requestBody` and `responseBody` are typed as `unknown` on the frontend because `toCall()` will parse the stored JSON strings — the result can be an object or a raw string.

### Frontend: toCall() mapping

`payload["requestBody"]` and `payload["responseBody"]` arrive as JSON strings (they were serialized before publishing). `toCall()` parses them back:

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

`toCall()` additions:

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

---

## UI: Expand-in-Place Pattern

### Signal and method added to ConnectorDetailComponent

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

### Row structure

The outer `@for` loop replaces the existing conditional `<a>` / `<div>` with a single `<div>` that is always clickable:

```html
@for (c of recentCalls(); track $index; let idx = $index) {
  <div
    class="call-row"
    [class.expanded]="expandedIdx() === idx"
    (click)="toggleExpand(idx)"
    role="button"
    tabindex="0"
    (keydown.enter)="toggleExpand(idx)"
    (keydown.space)="toggleExpand(idx)"
    aria-expanded="{{ expandedIdx() === idx }}"
  >
    <!-- summary columns (same content as current callCols template) -->
    <span class="call-ts">{{ c.timestamp }}</span>
    <span class="call-method">{{ c.method }}</span>
    <span class="call-status" [class]="statusClass(c.status)">{{ c.status }}</span>
    <span class="call-dur">{{ c.durationMs }}ms</span>
    <span class="call-url" [title]="c.resolvedUrl">{{ shortUrl(c.resolvedUrl) }}</span>
    @if (hasCacheConfig() && c.cacheResult) {
      <span class="call-cache" [class]="'cache-' + c.cacheResult">{{ c.cacheResult }}</span>
    }
    <span class="expand-chevron">{{ expandedIdx() === idx ? '▲' : '▼' }}</span>

    @if (expandedIdx() === idx) {
      <div class="call-detail" (click)="$event.stopPropagation()">

        <!-- Request -->
        <div class="detail-section">
          <div class="detail-label">Request</div>
          <div class="detail-row">
            <span class="detail-sub">URL</span>
            <pre class="detail-pre mono">{{ c.resolvedUrl }}</pre>
          </div>
          @if (c.requestHeaders) {
            <div class="detail-row">
              <span class="detail-sub">Headers</span>
              <pre class="detail-pre mono">{{ formatHeaders(c.requestHeaders) }}</pre>
            </div>
          }
          @if (c.requestBody) {
            <div class="detail-row">
              <span class="detail-sub">Body</span>
              <pre class="detail-pre mono">{{ formatBody(c.requestBody) }}</pre>
            </div>
          }
        </div>

        <!-- Response -->
        <div class="detail-section">
          <div class="detail-label">Response</div>
          @if (c.responseHeaders) {
            <div class="detail-row">
              <span class="detail-sub">Headers</span>
              <pre class="detail-pre mono">{{ formatHeaders(c.responseHeaders) }}</pre>
            </div>
          }
          @if (c.responseBody) {
            <div class="detail-row">
              <span class="detail-sub">Body</span>
              <pre class="detail-pre mono">{{ formatBody(c.responseBody) }}</pre>
            </div>
          }
        </div>

        <!-- Cache (conditional) -->
        @if (hasCacheConfig() && c.cacheResult) {
          <div class="detail-section">
            <div class="detail-label">Cache</div>
            <div class="detail-row">
              <span class="detail-sub">Result</span>
              <span class="call-cache" [class]="'cache-' + c.cacheResult">{{ c.cacheResult }}</span>
            </div>
            @if (c.cacheKey) {
              <div class="detail-row">
                <span class="detail-sub">Key</span>
                <pre class="detail-pre mono">{{ c.cacheKey }}</pre>
              </div>
            }
            @if (c.cacheTtlSeconds !== undefined) {
              <div class="detail-row">
                <span class="detail-sub">TTL</span>
                <span>{{ c.cacheTtlSeconds }}s</span>
              </div>
            }
          </div>
        }

        <!-- Trace link -->
        @if (c.correlationId) {
          <div class="detail-section detail-trace">
            <a [routerLink]="['/processes/trace', c.correlationId]" class="trace-link">
              <mat-icon>open_in_new</mat-icon>
              View trace
            </a>
          </div>
        }

      </div>
    }
  </div>
}
```

### Grid adjustment

The `.call-row` CSS grid adds a column for the chevron:
```css
grid-template-columns: 160px 60px 50px 70px 1fr auto auto;
```

The `.call-detail` panel spans all columns (`grid-column: 1 / -1`).

---

## Backward Compatibility

All new fields on `IEndpointCallEvent` are optional. The `emit()` function only serializes them into the payload when present (existing guard: check truthy before including, or let `undefined` serialize away naturally in JSON). Events emitted before this change (stored in the audit DB) simply lack these fields; `toCall()` returns `undefined` for the new optional fields, and the UI handles missing fields with `@if` guards.

The URL cap change from 120 → 2048 is not backward-compatible for consumers that expect the short URL behavior, but within this system the only consumer is the admin-console which gains more useful data.

---

## Service Boundaries

- `redact-headers.ts`, `truncate-body.ts` — pure functions, no dependencies, testable in isolation
- `event-publisher.ts` — receives already-redacted/truncated values; no sanitization logic lives here
- `endpoint-call.activity.ts` — orchestrates sanitization before publishing; owns the call-site
- `connector-call.service.ts` — pure mapping from raw audit row to typed domain object; no HTTP knowledge
- `connector-detail.component.ts` — pure presentation; no business logic
