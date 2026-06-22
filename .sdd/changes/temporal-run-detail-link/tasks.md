# Tasks: temporal-run-detail-link

## Ordered implementation checklist

---

### Task 1 — Extend `IWorkflowExecutionDetail` with `temporalRunId`

**File**: `services/admin-console/src/app/features/automation/workflows/services/workflow-api.service.ts`

Add `temporalRunId?: string` to the `IWorkflowExecutionDetail` interface, after `temporalWorkflowId`:

```ts
export interface IWorkflowExecutionDetail {
  executionId: string;
  definitionId: string;
  temporalWorkflowId: string;
  temporalRunId?: string;   // <-- add this line
  status: string;
  ...
}
```

**Acceptance**: TypeScript compiles without error. No existing usages of this interface
need changes (the field is optional).

---

### Task 2 — Add `environment` import to `WorkflowRunDetailComponent`

**File**: `services/admin-console/src/app/features/automation/workflows/detail/workflow-run-detail.component.ts`

Add the environment import alongside the existing imports at the top of the file:

```ts
import { environment } from "../../../../../environments/environment";
```

**Acceptance**: `environment.temporalUiBaseUrl` and `environment.temporalNamespace` are
accessible inside the class without TypeScript errors.

---

### Task 3 — Add `temporalUrl` computed signal

**File**: `workflow-run-detail.component.ts`

Add this computed signal to the class body (after `readonly crumbs = computed(...)` is
a good location):

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

**Acceptance**: When `detail()` is null or `temporalWorkflowId` is absent, the signal
returns `null`. When `temporalRunId` is present, the URL includes `/${runId}`. When
only `temporalWorkflowId` is present, the URL is workflow-level.

---

### Task 4 — Add the "Open in Temporal" link to the template

**File**: `workflow-run-detail.component.ts` (inline template)

Inside the `.run-actions` div (which already contains the Back and Retry buttons),
add the conditional anchor as the FIRST child (before the Back button):

```html
<div class="run-actions">
  @if (temporalUrl(); as url) {
    <a class="temporal-link" [href]="url" target="_blank" rel="noopener">
      Open in Temporal
    </a>
  }
  <button class="btn" type="button" (click)="back()">Back</button>
  <button class="btn btn-primary" type="button" (click)="retry()">
    Retry
  </button>
</div>
```

**Acceptance**: Link renders only when `temporalUrl()` is non-null. It opens in a new
tab. It appears to the left of the Back button in the header action row.

---

### Task 5 — Add `temporal-link` CSS class to component styles

**File**: `workflow-run-detail.component.ts` (inline styles)

Append to the existing `styles` string, after `.run-actions { ... }`:

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

**Acceptance**: The link renders as a pill-bordered button visually consistent with
the existing `.btn` buttons on the same page. No raw underline or unstyled anchor.

---

### Task 6 — Runtime verification of `temporalRunId` in the detail response

This is a manual verification step, not a code change.

**Steps**:
1. Open the admin console locally
2. Navigate to any workflow run detail page
3. Open DevTools Network tab
4. Inspect the response for `GET /workflows/:id/executions/:executionId`
5. Confirm whether `temporalRunId` is present in the JSON response

**Two outcomes**:

- **Field present**: The link will deep-link to the exact run. No backend change needed.
- **Field absent**: The link will render as a workflow-level URL (fallback behavior).
  If run-level precision is required, a backend change to the detail endpoint serializer
  must be requested separately.

**Acceptance**: The outcome is documented as a comment in the PR description so the
reviewer knows whether the link is run-level or workflow-level.
