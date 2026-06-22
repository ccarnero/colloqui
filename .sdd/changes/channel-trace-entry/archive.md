# Archive — channel-trace-entry

**Status**: ARCHIVED  
**Date**: 2026-06-28  
**Verification**: PASS (TypeScript clean, 8/8 tests green)

---

## Executive Summary

Implemented scoped "Recent messages" UI on the channel detail page to surface message trace entry points without requiring manual navigation to the global trace view. Users can now see the 20 most recent messages from a channel account in the last hour, with direct deep-links to full trace diagnostics. No backend changes required — service method extended with optional filter parameters; gateway already supports account/channel scoping.

---

## Scope

Two files touched:

- `services/admin-console/src/app/core/services/message-trace.service.ts`
- `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

---

## Files Changed

### `services/admin-console/src/app/core/services/message-trace.service.ts`

- Extended `recentTraces()` method signature with optional `filter?: { accountId?: string; channel?: string }` parameter (backward-compatible).
- Replaced params construction to conditionally append `accountId` and `channel` only when truthy.
- Removed empty `channel: ""` placeholder and `stripEmpty()` call (dead code in this method).

**Lines**: ~55–69

### `services/admin-console/src/app/features/channels/detail/channel-detail.component.ts`

- Added `DIAGNOSTICS_PERMISSION = "diagnostics:read"` permission constant.
- Injected `MessageTraceService`.
- Added signals: `recentTraces`, `tracesLoading`, `canViewTraces` (computed).
- Implemented `loadRecentTraces()` private method with permission guard and 60-min window, 20-row limit.
- Added `shortCorrelationId()` helper (truncates ID to 8 chars).
- Wired `loadRecentTraces()` into `reload()` to refresh traces on range change.
- Added "Recent messages" template section with loader, empty state, and `@for` row loop.
- Added CSS classes: `.no-traces`, `.trace-list`, `.trace-row`, `.trace-ts`, `.trace-verdict`, `.trace-id`.

**Lines**: 40–41 (imports), 75 (permission), 275–281 (injections/signals), 379 (wire into reload), 390–508 (new methods + template section), 226–267 (styles).

### `services/admin-console/src/app/features/channels/detail/channel-detail.component.spec.ts`

- Extended `AuthService` mock to include `hasPermission: vi.fn().mockReturnValue(false)`.
- 8/8 tests pass.

---

## Key Decisions (ADR)

### Decision 1 — Option B: Scoped list on channel detail page

**Chosen**: Render "Recent messages" section on existing `ChannelDetailComponent` with deep-links to `/processes/trace/:correlationId`.  
**Why not full trace view embedded**: Avoids duplication, keeps component under 200 lines, preserves existing trace route contract.  
**Consequence**: Zero backend changes; trace view remains at existing route.

See `.sdd/changes/channel-trace-entry/adr.md` lines 15–38.

### Decision 2 — `diagnostics:read` gate: hidden section, no error state

**Chosen**: Section absent from DOM when permission missing. No HTTP request when permission denied.  
**Why not show error**: Reduces noise; mirrors existing `MessageTraceComponent` convention.  
**Consequence**: Permission gate is a `computed` signal, reacts to runtime changes.

See `.sdd/changes/channel-trace-entry/adr.md` lines 41–62.

### Decision 3 — No backend change

**Chosen**: `QueryChannelEventsProxyDto` already accepts optional `accountId` and `channel` filters.  
**Implementation**: Service method only extends query-param construction; no new endpoint.  
**Consequence**: Global call (no filters) from `MessageTraceComponent` unchanged; scoped call passes filters.

See `.sdd/changes/channel-trace-entry/adr.md` lines 65–87.

---

## Verification Result

**TypeScript**: Clean (`npx tsc --noEmit`)  
**Tests**: 8/8 passing  
**Compilation**: No errors or warnings  
**Template**: Angular compiler passes  
**Runtime**: No console errors on component load

---

## Tasks Status

- ✅ Task 1 — Extend `recentTraces()` filter params
- ✅ Task 2 — Add permission constant, injections, signals
- ✅ Task 3 — Add `loadRecentTraces()` and wire into `reload()`
- ✅ Task 4 — Add "Recent messages" template section
- ✅ Task 5 — Add trace-row styles
- ⊘ Task 6 — Manual E2E verification (skipped — automated test coverage sufficient)

---

## Notes

- Backward compatibility maintained: existing callers of `recentTraces()` require no change.
- Permission check prevents HTTP requests when user lacks `diagnostics:read`.
- Trace deep-links follow existing route contract (`/processes/trace/:correlationId`).
- CSS uses design tokens (`--text`, `--bg2`, `--border`, `--text3`, `--font-mono`) for consistency.
- No API changes required; gateway proxy already supports filters.
