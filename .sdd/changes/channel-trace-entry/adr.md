# ADR — channel-trace-entry

## Context

Users debugging a Telegram (or any channel) account currently have to navigate to
Processes → Message trace, manually type a correlation ID, and guess which of the 10
most-recent global traces belongs to their account.

The channel detail page already shows per-account usage metrics and stream activity.
Adding a scoped "Recent messages" list here surfaces trace entry points without
requiring a separate navigation step.

---

## Decision 1 — Option B: scoped list on the channel detail page

### Chosen

Render a "Recent messages" section on the existing `ChannelDetailComponent`. Each row
links to `/processes/trace/:correlationId`. The existing trace view handles the full
diagnostic experience; the channel detail provides scoped entry points to it.

### Why not Option A (relocate or duplicate the trace view)

- A full trace view embedded in the channel detail would duplicate `MessageTraceComponent`
  logic, inflating the component beyond the ≤200-line file convention.
- Routing the trace view under `/channels/:channel/:accountId/trace` would break the
  existing deep-link contract and require route guard changes.
- The trace view is a feature-rich diagnostic tool that belongs in Processes. The channel
  detail should only provide navigation shortcuts.

### Consequences

- Zero backend changes.
- Two frontend files touched: `message-trace.service.ts` (service method extension) and
  `channel-detail.component.ts` (new section + helper).
- The full trace view remains at its existing route; this change adds a scoped entry point.

---

## Decision 2 — `diagnostics:read` gate: hidden section, no error state

### Chosen

The "Recent messages" section is conditionally rendered only when
`auth.hasPermission('diagnostics:read')` returns true. If the permission is absent, the
section is simply absent from the DOM. No error banner, no "permission denied" message,
no HTTP request.

### Why not show a permission error

- Users without `diagnostics:read` do not need to know the section exists. Surfacing
  a "you can't see this" message adds noise without value.
- This is the same convention used by `MessageTraceComponent`: the entire body is hidden
  under `@if (!canView())` with a minimal static message — no dynamic checks, no spinner.
- The gate is a `computed` signal, so it reacts correctly if permissions change at runtime.

### Consequences

- `loadRecentTraces()` returns early before any HTTP call when permission is absent, so
  there are no unauthorized requests.

---

## Decision 3 — No backend change

### Chosen

`QueryChannelEventsProxyDto` in `api-gateway` already declares `accountId?: string` and
`channel?: string` as optional passthrough params (lines 50 and 58 of
`audit-proxy-query.dto.ts`). The service method `recentTraces()` only needs to pass
these values in the query params it builds — no new gateway endpoint, no DTO change, no
audit-service change.

### Why the current `recentTraces()` doesn't use them

The original method always called the global list (no channel/account scoping) to back
the "Recent traces" dropdown in the full trace view. Scoping is a new use case introduced
by this change — the method is extended, not replaced.

### Consequences

- The global call (no filters) from `MessageTraceComponent` continues to work unchanged
  because the new `filter` parameter is optional with position 3.
- The scoped call from `ChannelDetailComponent` passes `{ accountId, channel }` and
  receives only events belonging to that account+channel.

---

## Alternatives rejected

| Option | Reason rejected |
|--------|----------------|
| New `recentTracesByChannel()` method | Duplicate implementation; a filter param is sufficient and keeps the API surface small |
| New `ChannelTraceListComponent` | Section is simple enough (a `@for` loop) to inline; a separate component would be premature extraction |
| Route `/channels/:channel/:accountId/trace` | Over-engineering; duplicates the trace route; breaks existing deep-link contract |
| Show traces in a dialog | Adds an interaction step; direct `[routerLink]` rows are faster for the debug workflow |
