# Proposal: yoizenclaw-angular-ui

## Intent

Provide a comprehensive management interface for YoizenClaw AI agents within the admin-console. Currently, platform operators must use raw API calls or backend tools to manage agents, jobs, and credentials. This change adds a dedicated UI section under `/yoizenclaw` route that enables non-technical users to:

- Create, configure, and deploy AI agents with custom skills and tools
- Schedule and monitor automated jobs with execution history
- Securely manage API credentials with rotation capabilities

This addresses the operational gap between the powerful YoizenClaw backend (yoizenclaw-admin-service) and the platform's unified management console.

## Scope

### In Scope
- **Agents Management**
  - CRUD operations for agents (name, description, model, temperature, system prompt)
  - Skills editor with Monaco Editor for YAML/JSON skill definitions
  - Tools editor for configuring agent capabilities (function calling)
  - Publish/Unpublish workflow for agent lifecycle
  - Status visualization (draft, published, archived)
  
- **Jobs Management**
  - CRUD operations for scheduled jobs (name, cron expression, associated agent)
  - Enable/Disable job toggle with immediate effect
  - Manual Run/Trigger for on-demand execution
  - Job Executions view with status, duration, and output logs
  - Execution history with pagination and filtering
  
- **Credentials Management**
  - CRUD operations for API credentials (name, provider, masked secrets)
  - Secure secret rotation workflow (generate new, revoke old)
  - Provider-specific configuration forms (OpenAI, Anthropic, etc.)
  - Active/Revoked status tracking

- **Infrastructure**
  - Tenant-aware HTTP client interceptors (inject `x-yoizen-tenant` header)
  - Feature module structure under `features/yoizenclaw/`
  - Route configuration for `/yoizenclaw/*` paths
  - Navigation sidebar integration (route already defined)

### Out of Scope
- **Webchat Configuration** - Channel-specific chat widgets (deferred to channels team)
- **Channel Integration Setup** - Connectors to WhatsApp, Slack, etc. (exists in channels feature)
- **Memory Lab** - Vector store and knowledge base management (future phase)
- **AI Assist / Playground** - Interactive agent testing interface (future enhancement)
- **Dashboard Metrics** - Extends existing overview dashboard (use overview feature)
- **Audit Logging UI** - Reuse existing `audit-log` feature for execution tracking
- **Real-time WebSocket updates** - Polling-based updates only (Phase 2)

## Approach

### Architecture
Implement a feature-module following established admin-console patterns:

```
features/yoizenclaw/
├── agents/
│   ├── components/
│   │   ├── agent-list/
│   │   ├── agent-form/
│   │   ├── skills-editor/ (Monaco)
│   │   └── tools-editor/
│   ├── services/agent.service.ts
│   └── agents.routes.ts
├── jobs/
│   ├── components/
│   │   ├── job-list/
│   │   ├── job-form/
│   │   └── executions-list/
│   ├── services/job.service.ts
│   └── jobs.routes.ts
├── credentials/
│   ├── components/
│   │   ├── credential-list/
│   │   ├── credential-form/
│   │   └── rotate-dialog/
│   ├── services/credential.service.ts
│   └── credentials.routes.ts
├── interceptors/
│   └── tenant.interceptor.ts
├── models/
│   ├── agent.model.ts
│   ├── job.model.ts
│   └── credential.model.ts
└── yoizenclaw.routes.ts
```

### Technical Decisions

1. **State Management**: Angular Signals for component state, services for shared state
2. **HTTP Layer**: HttpClient with interceptors (existing auth + new tenant interceptor)
3. **Code Editor**: @monaco-editor/loader for skills editing (lazy-loaded, supports YAML/JSON)
4. **UI Components**: Reuse existing data-table, status-badge, metric-card from `shared/`
5. **Forms**: Reactive Forms with Angular Material (MatFormField, MatInput, MatSelect)
6. **Multi-tenancy**: Interceptor injects `x-yoizen-tenant` from ConfigService (header constant from `@yoizen/shared`)

### Backend Integration
All operations hit `yoizenclaw-admin-service` via existing REST endpoints:
- Agents: `GET/POST/PUT/DELETE /admin/agents` + publish/unpublish actions
- Jobs: `GET/POST/PUT/DELETE /admin/jobs` + enable/disable/run/trigger + executions
- Credentials: `GET/POST/PUT/DELETE /admin/credentials` + rotate action

### Alternatives Considered

| Approach | Summary | Why Rejected |
|----------|---------|-------------|
| GraphQL with Apollo | Unified queries, strong typing | Backend is REST-only; adds complexity without benefit |
| NgRx Store | Centralized state management | Overkill for 3 CRUD features; Signals sufficient |
| Standalone feature (separate app) | Decoupled deployment | Violates unified admin-console principle; loses shared auth |
| Real-time with WebSockets | Live execution updates | Polling adequate for MVP; WebSockets add infra complexity |
| Custom code editor (CodeMirror) | Lighter than Monaco | Monaco is standard, has YAML support, lazy-loadable |

## Effort Estimation

- **Size**: M (Medium)
- **Estimated files**: ~35 new, 3 modified
  - New: 20 component files, 3 service files, 6 model files, 3 route files, 1 interceptor, 2 utility files
  - Modified: 1 app.routes.ts, 1 sidebar config, 1 shared barrel export
- **Complexity drivers**:
  - Monaco Editor integration for skills editing
  - Multi-tenant header injection across all API calls
  - Job execution polling mechanism
  - Form complexity (nested skills/tools configuration)
- **Suggested SDD depth**: Full pipeline (proposal → spec → design → tasks → apply → verify → archive)

| Size | Guideline |
|------|----------|
| XS | Single file, < 50 lines changed |
| S | 1-3 files, straightforward |
| M | 4-10 files, some design decisions |
| L | 10+ files, cross-module, needs design |
| XL | Architecture change, multi-phase |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `services/admin-console/src/app/features/yoizenclaw/` | New | Complete feature module for YoizenClaw management |
| `services/admin-console/src/app/app.routes.ts` | Modified | Add lazy-loaded route for `/yoizenclaw` |
| `services/admin-console/src/app/layout/sidebar/` | Modified | Activate existing `/yoizenclaw` route in navigation |
| `services/admin-console/src/app/core/interceptors/` | Modified | Add tenant.interceptor.ts alongside auth.interceptor.ts |
| `services/admin-console/src/app/shared/components/` | Modified | Export data-table, status-badge for yoizenclaw use |
| `services/yoizenclaw-admin-service` | None | Already provides required REST APIs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Monaco Editor bundle size impact | Low | Use @monaco-editor/loader for dynamic import; lazy-load editor component only when skills tab active |
| Tenant header injection failure | Med | Add HTTP interceptor tests; validate header presence in request logs; fallback to error toast |
| API response format mismatch | Low | Generate TypeScript interfaces from OpenAPI spec; add runtime validation with zod |
| Job execution polling overhead | Med | Implement exponential backoff; cap at 30s intervals; auto-stop after 5 min |
| Form state complexity | Low | Use Reactive Forms with custom validators; break skills/tools into sub-forms |
| Monaco editor accessibility issues | Low | Provide fallback textarea for screen readers; ensure keyboard navigation |

## Rollback Plan

If issues are detected post-deployment:

1. **Immediate**: Disable route in `app.routes.ts` by commenting out `/yoizenclaw` lazy-load entry
2. **Navigation**: Hide sidebar menu item (already controlled by feature flag config)
3. **Data Safety**: All CRUD operations are read-only on backend; no data migration needed
4. **Revert Commit**: `git revert <merge-commit>` removes all 35 new files
5. **Hotfix Path**: Can deploy route disable without full rollback (single-line change)

## Dependencies

| Dependency | Source | Status |
|------------|--------|--------|
| `yoizenclaw-admin-service` APIs | Backend | Available - agents, jobs, credentials endpoints exist |
| `@yoizen/shared` TENANT_HEADER | Shared lib | Available - constant for `x-yoizen-tenant` header |
| `@monaco-editor/loader` | NPM | New dependency to add to package.json |
| Admin-console auth interceptor | Existing | Works with JWT, no changes needed |
| Angular Material | Existing | MatTable, MatPaginator, MatDialog available |

## Success Criteria

- [ ] All 3 feature areas accessible via `/yoizenclaw/*` routes with lazy loading
- [ ] Agents: Create, edit, publish, unpublish agents with skills editor (Monaco)
- [ ] Jobs: CRUD + enable/disable + manual trigger + executions view with polling
- [ ] Credentials: CRUD + rotate workflow with confirmation dialog
- [ ] Multi-tenancy: Every API call includes `x-yoizen-tenant` header (verified via network tab)
- [ ] Reuse: All lists use shared data-table component; all statuses use status-badge
- [ ] Performance: Initial page load < 2s, skills editor lazy-loads on demand
- [ ] Accessibility: Keyboard navigation works, ARIA labels present, color contrast met
- [ ] No `any` types: All API responses typed, strict mode passes
