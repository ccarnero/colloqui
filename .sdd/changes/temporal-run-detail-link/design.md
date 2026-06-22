# Design: temporal-run-detail-link

## Context

The workflow run detail page (`/workflows/:id/runs/:runId`) shows execution metadata
but has no link to the corresponding Temporal UI run. The message trace page already
implements this pattern with an "Open in Temporal" anchor. The goal is to replicate
that pattern in the run detail page, deep-linking to the exact Temporal run (not just
the workflow), with a matching visual style.

---

## Key Findings from Exploration

### `IWorkflowExecutionDetail` is missing `temporalRunId`

`workflow-api.service.ts` line 58–75:
```ts
export interface IWorkflowExecutionDetail {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;  // present
  status: string;
  result?: { ... };
  failure?: { ... };
  createdAt: string;
  // temporalRunId is NOT here
}
```

`IWorkflowExecutionRow` (the list DTO, line 29–39) DOES have `temporalRunId: string`,
which means the backend execution record already carries the field. The detail endpoint
(`GET /workflows/:id/executions/:executionId`) likely returns it in the JSON response
already — it just is not typed in the interface, so TypeScript ignores it.

**Risk**: if the backend detail endpoint does not include `temporalRunId` in its
serialized response (only in the list projection), then the field will be `undefined`
at runtime even after the TS change. The component must gracefully fall back to a
workflow-level URL in that case.

### Environment is ready

`environment.ts` already exposes `temporalUiBaseUrl` and `temporalNamespace`. No
environment changes are needed.

### Reference implementation (message-trace)

`message-trace.component.ts` builds the URL inline (no shared service):
```ts
temporalUrl(v: ITraceView): string | null {
  const base = environment.temporalUiBaseUrl;
  if (!base || !v.temporalWorkflowId) return null;
  return `${base}/namespaces/${environment.temporalNamespace}/workflows/${encodeURIComponent(v.temporalWorkflowId)}`;
}
```
CSS class `mt-temporal` renders a pill-bordered link with hover background.

---

## Approach

### No backend change required (assumption)

The backend execution record already stores `temporalRunId` (proven by its presence in
the list DTO). We assume the detail endpoint serializes the same field. Adding it to
the TS interface and testing at runtime will confirm or refute this. If the backend
does NOT return it, the component degrades to a workflow-level URL — which is still
better than nothing.

If confirmation is needed before apply, inspect the network response in DevTools for
`GET /workflows/:id/executions/:executionId`.

### DTO change

Add `temporalRunId?: string` to `IWorkflowExecutionDetail` in
`workflow-api.service.ts`. Optional (`?`) because:
- backward compatible if the backend does not return it
- allows the component to implement the fallback without a type error

### URL computation

Add a `temporalUrl` computed signal to `WorkflowRunDetailComponent`:

```ts
readonly temporalUrl = computed<string | null>(() => {
  const d = this.detail();
  const base = environment.temporalUiBaseUrl;
  if (!base || !d?.temporalWorkflowId) return null;
  const wf = encodeURIComponent(d.temporalWorkflowId);
  const run = d.temporalRunId ? encodeURIComponent(d.temporalRunId) : null;
  const ns = environment.temporalNamespace;
  return run
    ? `${base}/namespaces/${ns}/workflows/${wf}/${run}`
    : `${base}/namespaces/${ns}/workflows/${wf}`;
});
```

- Reactive: automatically updates when `detail` signal changes.
- Falls back to workflow-level URL if `temporalRunId` is absent.
- Returns `null` if `temporalUiBaseUrl` is not configured (consistent with
  message-trace pattern; the link simply does not render).

### Template placement

Add the link inside the existing `.run-actions` div, alongside the Back and Retry
buttons. This keeps all page-level actions in one row and matches the message-trace
precedent of placing the link near the primary action controls.

```html
@if (temporalUrl(); as url) {
  <a class="temporal-link" [href]="url" target="_blank" rel="noopener">
    Open in Temporal
  </a>
}
```

### CSS

Add a `temporal-link` class to the component styles, adapted from `mt-temporal` in
message-trace but without `margin-top` (not needed inside a flex row):

```css
.temporal-link {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  padding: 6px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius, 6px);
  text-decoration: none;
  color: var(--text-primary);
  background: var(--bg-surface);
}
.temporal-link:hover { background: var(--bg3); }
```

This uses the run-detail component's own CSS variables rather than the message-trace
variables (`--border` vs `--border-subtle`, `--text` vs `--text-primary`) to stay
consistent with the existing `btn` style already on this page.

---

## ADR — Option B: Run-level deep link

### Context

Option A: link to the workflow (omit `temporalRunId`), using only `temporalWorkflowId`.
Option B: link to the exact run by appending `/${runId}` to the URL.

### Decision

**Use Option B (run-level link).**

### Rationale

The detail page is scoped to a single execution run. A link to the workflow in Temporal
UI would show all runs, requiring the user to find the specific run manually — extra
friction with no benefit. The Temporal UI supports run-level deep links via
`/workflows/{workflowId}/{runId}`, which opens that exact run directly. The run detail
page is the right place to use this level of precision.

### Consequences

- Users land on the exact run in Temporal UI in one click.
- If `temporalRunId` is absent (backend does not serialize it yet), the component
  transparently falls back to Option A behavior without breaking.
- `IWorkflowExecutionDetail` gains an optional field — no breaking change.

### Alternatives rejected

**Option A (workflow-level link only):** Simpler, but forces users to manually locate
the run within Temporal's run list. Rejected because the detail page is already
scoped to a single run, and the URL pattern for run-level links exists and is stable.

---

## Files to touch

| File | Change |
|---|---|
| `services/admin-console/src/app/features/automation/workflows/services/workflow-api.service.ts` | Add `temporalRunId?: string` to `IWorkflowExecutionDetail` |
| `services/admin-console/src/app/features/automation/workflows/detail/workflow-run-detail.component.ts` | Add `temporalUrl` computed signal, template link, CSS class, `environment` import |

No backend changes. No shared service changes. No route changes.

---

## Backward compatibility

- `temporalRunId?: string` is optional — no existing consumers of `IWorkflowExecutionDetail` break.
- The link renders only when `temporalUiBaseUrl` is set and the detail loaded — no
  null-pointer risk.
- `environment.prod.ts` already has `temporalUiBaseUrl: ""`, so the link is hidden
  in production until the field is configured — consistent with message-trace behavior.
