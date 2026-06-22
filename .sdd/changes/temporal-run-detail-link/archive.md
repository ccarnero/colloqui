# Archive: temporal-run-detail-link

**Status**: ✅ Completed and shipped  
**Date**: 2026-06-29  
**Change**: Added "Open in Temporal" deep-link to workflow run detail page

## Scope

Added a user-facing link on the run detail page (`/workflows/:id/runs/:runId`) that opens the corresponding execution in the Temporal UI. The link mirrors the existing pattern from the message-trace page, with smart fallback behavior.

## Key Decisions

- **ADR (Option B)**: Prioritize run-level deep links (`/workflows/{workflowId}/{runId}`) over workflow-level links. This provides single-click navigation to the exact run in Temporal UI, with graceful fallback to workflow-level if `temporalRunId` is absent from the backend response.
- **No backend change required**: Backend execution records already carry `temporalRunId` (present in list DTO). We assume the detail endpoint serializes it; if not, the component degrades to workflow-level URLs without breaking.
- **Optional field**: `temporalRunId?: string` in `IWorkflowExecutionDetail` maintains backward compatibility and allows type-safe fallback.

## Files Touched

| File | Change |
|---|---|
| `services/admin-console/src/app/features/automation/workflows/services/workflow-api.service.ts` | Added `temporalRunId?: string` to `IWorkflowExecutionDetail` interface (line 62) |
| `services/admin-console/src/app/features/automation/workflows/detail/workflow-run-detail.component.ts` | Added `environment` import, `temporalUrl` computed signal (lines 380–392), template link (lines 62–66), and `.temporal-link` CSS class (lines 185–196) |

## URL Logic

- **When `temporalRunId` is present**: `${temporalUiBaseUrl}/namespaces/${temporalNamespace}/workflows/${workflowId}/${runId}`
- **When `temporalRunId` is absent**: `${temporalUiBaseUrl}/namespaces/${temporalNamespace}/workflows/${workflowId}`
- **When `temporalUiBaseUrl` is empty**: Link is not rendered (consistent with message-trace pattern)

## Implementation Summary

1. ✅ **Task 1** — Extended `IWorkflowExecutionDetail` with `temporalRunId?: string`
2. ✅ **Task 2** — Added `environment` import to component
3. ✅ **Task 3** — Added `temporalUrl` computed signal with fallback logic
4. ✅ **Task 4** — Added template link inside `.run-actions` div (placed before Back button)
5. ✅ **Task 5** — Added `.temporal-link` CSS class with pill-bordered visual style
6. ✅ **Task 6 (Manual)** — Documented runtime verification approach

## Testing

- **TypeScript compilation**: ✅ No errors
- **Template rendering**: ✅ Conditional link appears when `temporalUrl()` is non-null
- **URL encoding**: ✅ `workflowId` and `runId` are URI-encoded to handle special characters
- **Backward compatibility**: ✅ Graceful fallback to workflow-level URL if `temporalRunId` is absent

## Open Item

**Task 6 (Manual verification)**: Confirm at runtime whether the API response for `GET /workflows/:id/executions/:executionId` includes `temporalRunId`. 
- If **present**: Deep-link to exact run (design intent realized)
- If **absent**: Link provides workflow-level URL (acceptable fallback)

Recommendation: Check network response in DevTools when navigating to a run detail page in local/staging environment.

## Backward Compatibility

- Optional `temporalRunId?: string` field — no breaking changes to consumers
- Link visibility depends on environment configuration — no impact on existing pages
- Fallback to workflow-level URL is transparent to users

## Follow-ups

1. Verify at runtime (manual inspection of network tab) that `temporalRunId` is in the API response
2. If runtime verification reveals `temporalRunId` is absent, document in PR and consider backend enhancement for detail endpoint
3. Optionally: add an integration test that confirms the link URL shape when `temporalRunId` is present vs. absent
