# ADR: Connector Recent Calls — HTTP Exchange Detail

## Context

The connector detail page shows a "Recent calls" table with only 7 columns: timestamp, method, status, duration, URL, cache badge, and a trace link. Debugging connector failures requires inspecting the actual HTTP exchange — request headers, body, response headers, body — but this data is not captured or surfaced anywhere.

The data is available in `endpoint-call.activity.ts` at publish time. It must be sanitized before leaving the runtime process and stored compactly enough not to bloat the audit log.

---

## Decision 1: Header Redaction Approach — Name-Based Pattern Set

**Decision:** Strip headers whose lowercased name matches an exact set OR contains one of a substring list, replacing the value with `"[REDACTED]"`. Keys are preserved.

**Exact set:** `authorization`, `x-api-key`, `x-api-secret`, `cookie`, `set-cookie`

**Contains fragments:** `token`, `secret`, `key`, `auth`

**Consequences:**
- False positives: headers like `content-type-key` would be redacted. Acceptable — it is better to over-redact than to leak credentials.
- False negatives: a custom secret header named `x-service-credential` would NOT be redacted. Acceptable for the initial implementation; the set can be extended.
- The redacted output is logged to NATS and persisted in the audit DB, so the "keeps keys, redacts values" approach preserves debuggability (you can see which headers were sent) without exposing secrets.

**Alternatives rejected:**
- **Allowlist (only pass safe headers):** More secure but brittle — would drop legitimate debugging headers like `content-type` or `x-correlation-id`. Not practical without a maintained explicit allowlist.
- **Strip all headers:** Loses all debugging value. Rejected.
- **Value-based heuristic (scan for JWT patterns etc.):** Fragile and computationally heavier. The name-based approach is O(n) and deterministic. Rejected.

---

## Decision 2: Body Truncation at 8 KB

**Decision:** Serialize body to string (JSON.stringify if object), then slice to 8192 chars if longer.

**Consequences:**
- Bodies up to 8 KB are stored verbatim. Larger bodies are truncated — the stored string may not be valid JSON after truncation.
- The frontend must handle both valid JSON objects and raw strings gracefully (try-parse, fall back to raw display).
- 8 KB is large enough to contain most API responses and request payloads used in workflow automation while protecting the audit DB from megabyte-scale entries.

**Alternatives rejected:**
- **No limit:** Risk of audit DB bloat from large webhook payloads or binary-adjacent responses. Rejected.
- **1 KB limit:** Too small for realistic JSON API responses. Rejected.
- **Compress and store full body:** Adds complexity and cost in the audit pipeline; not warranted for an observability feature. Rejected.
- **Store as separate document with reference:** Adds a storage tier and query hop. Over-engineered for this use case. Rejected.

---

## Decision 3: URL Cap Raised from 120 to 2048

**Decision:** Raise `MAX_URL_LEN` in `event-publisher.ts` from 120 to 2048 characters.

**Context:** The 120-char cap was a conservative first-pass limit. With request detail visible in the expanded panel, the full URL is essential for debugging query parameters. The WHATWG URL spec caps maximum URL length at 2083 characters in some browsers; 2048 is a safe practical ceiling.

**Consequences:**
- The existing unit test `"truncates resolvedUrl longer than 120 chars"` must be updated to assert truncation at 2048.
- NATS payloads grow slightly for long URLs, but this is negligible.
- The admin-console `shortUrl()` helper that already caps display at 120 chars remains correct for the summary row.

**Alternatives rejected:**
- **Remove the cap entirely:** A URL without any length bound could theoretically carry a very large query string. Keeping a cap at 2048 provides a predictable maximum payload contribution. Rejected for unlimited.
- **Keep at 120:** Destroys debug utility for parametric URLs. Rejected.

---

## Decision 4: Row Click Expands; Trace Link Moves to Panel

**Decision:** Replace the conditional `<a>` / `<div>` row pattern with a single `<div role="button">` that toggles the expanded panel on click. The trace link moves from the row itself into the expanded detail panel as a labeled link with an icon.

**Context:** The current pattern uses `<a routerLink>` when a `correlationId` is present, meaning clicking the row navigates away. This is incompatible with click-to-expand.

**Consequences:**
- The trace link is slightly less prominent (requires one click to reveal the panel, then a second to navigate). Acceptable — trace navigation is a secondary action relative to inspecting the HTTP detail.
- Keyboard accessibility is maintained via `role="button"`, `tabindex="0"`, and `keydown.enter` / `keydown.space` handlers.
- The `<a>` element inside the expanded panel is a proper anchor with a visible label, which is better for accessibility than an anonymous row link.

**Alternatives rejected:**
- **Keep `<a>` on row, add a separate expand chevron/button inside it:** Nested interactive elements (`<a>` containing `<button>`) is invalid HTML and causes accessibility issues. Rejected.
- **Keep `<a>`, open detail in a side panel or modal:** Adds complexity and a new UI component. Expand-in-place matches the established pattern in `schedule-executions.component.ts`. Rejected.
- **Two-click: first click highlights row, second click expands:** Adds unnecessary friction. Rejected.

---

## Decision 5: Sanitization Belongs in the Activity, Not the Publisher

**Decision:** `redactHeaders()` and `truncateBody()` are called in `endpoint-call.activity.ts` before passing data to `publishEndpointCallEvent()`. The publisher receives already-sanitized values and is unaware of redaction logic.

**Consequences:**
- Single responsibility: the publisher is a transport layer; it does not know about security concerns.
- Testing is simpler — redaction utilities are pure functions testable without mocking NATS.
- The activity becomes the explicit owner of "what data is safe to emit."

**Alternatives rejected:**
- **Sanitize inside `emit()` in event-publisher.ts:** Mixes security logic with transport logic. If the publisher is reused for other event types, redaction logic bleeds incorrectly. Rejected.
- **Sanitize at the audit-service ingestion layer:** Too late — data would already be in the NATS message in clear text. Rejected.
