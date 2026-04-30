# Proposal: YoizenClaw Adapter Tools Integration

## Intent

Enable YoizenClaw agents to use platform Connectors (Adapters) as tools without writing code. Currently, adapters in `adapter-service` provide HTTP connectivity with authentication, retries, and caching, but YoizenClaw agents cannot use them dynamically. This change allows admins to configure agents with adapter-backed tools through the UI, enabling reuse of existing adapters (Salesforce, HubSpot, custom APIs) as LLM tools.

## Scope

### In Scope
- Extend `AgentToolPayload` schema with `adapterRef` field (adapterId + endpointId)
- Create Python `AdapterClient` for resolving adapter config at runtime
- Create `AdapterToolExecutor` to execute adapter endpoints with auth injection
- Wire `AdapterToolExecutor` into `ToolExecutor` dispatch logic
- Add validation in `yoizenclaw-admin-service` for `adapterRef` references
- Update agent configuration UI to select adapters as tool sources
- Add unit tests for adapter tool resolution and execution

### Out of Scope
- New adapter types (use existing adapter-service CRUD)
- OAuth2 token refresh flow (defer toadapter-service)
- Adapter health monitoring in YoizenClaw runtime
- Bulk adapter-to-tool migration tool

## Approach

Extend the existing tool schema with an optional `adapterRef` field. When `ToolExecutor` detects an `adapterRef`, it delegates to a new `AdapterToolExecutor` that:
1. Fetches adapter config from `adapter-service` via HTTP
2. Resolves the endpoint URL and authentication headers
3. Executes the HTTP request with tenant context
4. Returns the response to the agent

```
Agent Config                    YoizenClaw Runtime
     │                                  │
     ├── tools:                         │
     │   - name: "crm_lookup"          │
     │     adapterRef:                  │
     │       adapterId: "salesforce"   │
     │       endpointId: "get-contact"  │
     │                                  │
     └─────────────────────────────────►│
                          ToolExecutor._execute_tool_payload()
                                    │
                                    ▼
                    AdapterToolExecutor.execute()
                                    │
                                    ▼
                    Python AdapterClient.resolve_request()
                                    │
                                    ▼
                    HTTP POST to external API (with auth headers)
```

### Alternatives Considered

| Approach | Summary | Why Rejected |
|----------|---------|--------------|
| **Generate tool definitions from adapters** | Admin service generates tool YAML from adapters during sync | More complex, requires tool regeneration on adapter changes |
| **Runtime bridge service** | New microservice translates tool calls to adapter invocations | Adds deployment complexity, latency, and failure points |
| **Direct HTTP in tools** | Configure full URLs/auth in tool definition | Leaks credentials, no central management, no reuse |
| **NATS bridge** | Route tool calls through NATS to adapter-service | Adds messaging overhead, complex error handling |

## Effort Estimation

- **Size**: L
- **Estimated files**: 12 new, 8 modified, 0 deleted
- **Complexity drivers**:
  - Python HTTP client for adapter-service
  - Auth header injection (5 auth types)
  - Template substitution for dynamic payloads
  - Error mapping between adapter errors and tool errors
- **Suggested SDD depth**: Full pipeline (proposal→specs→design→tasks→apply)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/shared-python/` | New | Python `AdapterClient` package |
| `applications/yoizenclaw-application/src/tools/` | New | `adapter_executor.py`, `adapter_client.py` |
| `applications/yoizenclaw-application/src/application/agents/` | Modified | `tool_executor.py` dispatch logic |
| `applications/yoizenclaw-application/src/shared/config/` | Modified | `agent_config.py` schema |
| `services/yoizenclaw-admin-service/src/modules/agents/` | Modified | DTO validation, schema |
| `services/admin-console/src/app/features/automation/` | Modified | Tool configuration UI |
| `services/api-gateway/src/modules/admin/` | Modified | Proxy routes for adapter lookup |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Adapter-service unavailable during tool execution | Medium | Cache adapter config with TTL (60s soft, 300s hard); fallback to cached |
| Auth credentials rotation | Low | Adapter-service manages rotation; YoizenClaw fetches fresh config per execution |
| Response payload too large for LLM context | Medium | Add response truncation/summarization in `AdapterToolExecutor` |
| Tenant isolation breach | Low | Tenant ID propagated from agent context; validated in adapter-service |
| Circular dependency (adapter needs YoizenClaw) | Low | Document constraint; adapters cannot reference YoizenClaw tools |

## Rollback Plan

1. **Feature flag**: `YOIZENCLAW_ADAPTER_TOOLS_ENABLED` (default: false)
2. If issues detected:
   - Set flag to `false` in environment
   - Existing HTTP/NATS tools continue working
   - Remove `adapterRef` from agent configs via admin UI
3. **Database rollback**: `adapterRef` is optional JSON field; no schema migration required
4. **Code rollback**: Revert PR; agent configs with `adapterRef` are ignored (treated as missing tool)

## Dependencies

- `adapter-service` must be deployed and accessible from YoizenClaw runtime
- `api-gateway` must route `/admin/adapters/*` to adapter-service (existing)
- Python HTTP client library (`httpx` or `aiohttp`) in YoizenClaw runtime

## Success Criteria

- [ ] Admin can configure agent tool with `adapterRef` in UI
- [ ] Tool execution resolves adapter config and injects auth headers
- [ ] Response from adapter endpoint is returned to agent
- [ ] Error responses are mapped to tool errors with context
- [ ] Tenant isolation is maintained (X-Yoizen-Tenant header propagated)
- [ ] Unit tests cover adapter resolution, auth injection, and error handling
- [ ] E2E test: agent uses adapter tool and receives valid response
- [ ] Documentation updated: "Using Adapters as Tools"

## Open Questions

1. Should adapter configs be cached per-tenant in YoizenClaw runtime?
2. What timeout should adapter tool calls use? (Default: adapter.timeoutMs or 30s)
3. Should tool payload support Jinja2 templates for dynamic adapter parameters?
4. How to handle binary responses (images, files) from adapters?