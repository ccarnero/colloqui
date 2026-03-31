# Tasks: YoizenClaw Adapter Tools Integration

**Total Effort**: 55 points | **Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 4
**TDD**: enabled

## Phase 1: Foundation (Schema & Types)

- [x] 1.1 Add `AdapterReference` model to `agent_config.py` `[S]`
- [x] 1.2 Add `adapterRef` field to `AgentToolPayload` with mutual exclusion validator `[S]`
- [x] 1.3 Add `AdapterReferenceDto` and update `AgentToolDto` in `agents.dto.ts` `[S]`
- [x] 1.4 Add validation for `endpoint` OR `adapterRef` in admin-service DTO `[S]`

## Phase 2: Python AdapterClient (Core Implementation)

### TDD: AdapterClient Cache Behavior

- [x] 2.1 [RED] Write failing test for `AdapterClient.get_adapter()` cache hit `[S]`
- [x] 2.2 [GREEN] Implement `AdapterClient.get_adapter()` with LRU cache `[M]`
- [x] 2.3 [REFACTOR] Extract cache logic to separate `_AdapterCache` class `[XS]`

### TDD: Adapter Request Resolution

- [x] 2.4 [RED] Write failing test for `resolve_request()` URL construction `[S]`
- [x] 2.5 [GREEN] Implement `resolve_request()` method `[M]`
- [x] 2.6 [REFACTOR] Simplify URL construction with utility function `[XS]`

### TDD: Auth Header Injection

- [x] 2.7 [RED] Write failing test for `_inject_auth_headers()` all auth types `[S]`
- [x] 2.8 [GREEN] Implement auth header injection for `none`, `api-key`, `bearer`, `basic`, `oauth2` `[M]`
- [x] 2.9 [REFACTOR] Use strategy pattern for auth type handlers `[S]`

### TDD: Error Handling

- [x] 2.10 [RED] Write failing test for adapter not found error `[S]`
- [x] 2.11 [RED] Write failing test for endpoint not found error `[S]`
- [x] 2.12 [GREEN] Implement error mapping with sanitized messages `[S]`

## Phase 3: AdapterToolExecutor & Integration

### TDD: Tool Executor Integration

- [x] 3.1 [RED] Write failing test for `AdapterToolExecutor.execute()` success path `[M]`
- [x] 3.2 [GREEN] Implement `AdapterToolExecutor.execute()` with HTTP client `[M]`
- [x] 3.3 [REFACTOR] Extract HTTP execution to `_HttpExecutor` helper `[S]`

### TDD: Response Handling

- [x] 3.4 [RED] Write failing test for response truncation over 100KB `[S]`
- [x] 3.5 [GREEN] Implement response truncation with `_truncated` flag `[S]`
- [x] 3.6 [REFACTOR] Move truncation to `_ResponseTruncator` utility `[XS]`

### TDD: Tool Dispatch Integration

- [x] 3.7 [RED] Write failing test for `ToolExecutor` routing to `AdapterToolExecutor` `[S]`
- [x] 3.8 [GREEN] Add adapter branch in `ToolExecutor._execute_configured_tool()` `[S]`
- [x] 3.9 [RED] Write failing test for feature flag disabling adapter tools `[S]`
- [x] 3.10 [GREEN] Implement `YOIZENCLAW_ADAPTER_TOOLS_ENABLED` feature flag check `[XS]`

### Wiring

- [x] 3.11 Register `AdapterClient` in DI providers `[S]`
- [x] 3.12 Register `AdapterToolExecutor` in DI providers `[S]`
- [x] 3.13 Wire `AdapterClient` to environment config (ADAPTER_SERVICE_URL) `[S]`

## Phase 4: Admin Service & UI

### Admin Service

- [x] 4.1 [RED] Write failing test for `POST /admin/agents` with adapter tool `[S]`
- [x] 4.2 [GREEN] Add adapter lookup proxy route in `AdminProxyService` `[S]`
- [x] 4.3 Create `AdaptersController` with `GET /admin/adapters`, `GET /admin/adapters/:id` `[M]`
- [x] 4.4 [RED] Write failing test for adapter existence validation `[S]`
- [x] 4.5 [GREEN] Implement optional adapter validation with warning log `[S]`

### Admin UI

- [x] ⊕ 4.6 Create `ToolAdapterFormComponent` with adapter/endpoint dropdowns `[M]`
- [x] ⊕ 4.7 Create `AdaptersService` for `/admin/adapters` API calls `[S]`
- [x] 4.8 Integrate `ToolAdapterFormComponent` into agent tools form `[S]`
- [x] 4.9 Add "Tool Source: HTTP | Adapter" toggle to tool form `[S]`
- [x] 4.10 Add adapter preview section (resolved URL, method, auth type) `[M]`
- [x] 4.11 Add validation feedback for invalid/nonexistent adapters `[S]`

## Phase 5: Testing & Documentation

### Integration Tests

- [x] 5.1 Write integration test: agent executes adapter tool end-to-end `[M]`
- [x] 5.2 Write integration test: adapter-service unavailable returns cached response `[S]`
- [x] 5.3 Write integration test: auth header injection for all auth types `[M]`

### E2E Tests

- [x] 5.4 Write E2E test: create agent with adapter tool via UI `[M]`
- [x] 5.5 Write E2E test: execute agent with adapter tool, verify response `[M]`

### Documentation

- [x] 5.6 Update AGENTS.md with adapter tools documentation `[S]`
- [x] 5.7 Add `docs/adapter-tools.md` with usage examples `[M]`

## Phase 6: Cleanup

- [x] 6.1 Add `YOIZENCLAW_ADAPTER_TOOLS_ENABLED=true` to default env config `[XS]`
- [x] 6.2 Remove feature flag after validated in production `[XS]`

---

## Task Relationships

```
Phase 1 (1.1-1.4) ──► Phase 2 (2.1-2.12)
                              │
                              ▼
Phase 3 (3.1-3.13) ──► Phase 4 (4.1-4.5)
                              │
                              ▼
                       Phase 4 (4.6-4.11) ──► Phase 5
```

## Parallelizable Tasks

- Phase 2.1-2.3 (cache), 2.4-2.6 (resolution), 2.7-2.9 (auth) can run in parallel
- Phase 4.6 and 4.7 can run in parallel
- Phase 5.1, 5.2, 5.3 can run in parallel after Phase 4 completes