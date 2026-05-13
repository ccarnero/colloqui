# UI Flows

This document explains how UI actions in Angular consoles map to backend services and internal execution paths.

All UI traffic goes through `api-gateway`.

## YoizenClaw Agent CRUD (admin-console)

### Component to Backend Mapping

| UI area | Frontend location | Gateway path | Backend owner |
|---|---|---|---|
| Agent management | `admin-console` YoizenClaw screens | `/admin/*` via gateway | `yoizenclaw-admin-service` |
| Runtime test chat (playground) | `features/automation/yoizenclaw/playground.component.ts` | `/runtime/executions` | `yoizenclaw-runtime-gateway` |

### Create / Edit Agent

```mermaid
sequenceDiagram
    autonumber
    participant UI as admin-console
    participant GW as api-gateway
    participant YZA as yoizenclaw-admin-service
    participant DB as Tenant PostgreSQL

    UI->>GW: create/update agent request
    GW->>YZA: proxy /admin/... request
    YZA->>DB: persist agent config
    YZA-->>GW: response
    GW-->>UI: response
```

### Publish Agent

```mermaid
sequenceDiagram
    autonumber
    participant UI as admin-console
    participant GW as api-gateway
    participant YZA as yoizenclaw-admin-service
    participant NATS as NATS INGRESS-tenant
    participant YZR as yoizenclaw-runtime

    UI->>GW: publish agent
    GW->>YZA: proxy publish request
    YZA->>NATS: publish runtime config sync event
    NATS->>YZR: deliver config sync
    YZR-->>YZR: load/update runtime config
    YZA-->>GW: publish accepted
    GW-->>UI: publish result
```

### Delete Agent

```mermaid
sequenceDiagram
    autonumber
    participant UI as admin-console
    participant GW as api-gateway
    participant YZA as yoizenclaw-admin-service
    participant DB as Tenant PostgreSQL
    participant NATS as NATS INGRESS-tenant
    participant YZR as yoizenclaw-runtime

    UI->>GW: delete agent
    GW->>YZA: proxy delete request
    YZA->>DB: remove/deactivate agent
    YZA->>NATS: publish runtime config sync
    NATS->>YZR: update active runtime config
    GW-->>UI: 204/200
```

## Test Chat (Playground)

The playground does not go through Temporal workflow orchestration. It submits execution directly to runtime gateway and then polls execution status.

### Execution Flow

```mermaid
sequenceDiagram
    autonumber
    participant UI as admin-console playground
    participant GW as api-gateway
    participant YZG as yoizenclaw-runtime-gateway
    participant Redis as Redis
    participant NATS as NATS INGRESS-tenant
    participant YZR as yoizenclaw-runtime

    UI->>GW: POST /runtime/executions
    GW->>YZG: proxy POST /runtime/executions
    YZG->>Redis: write pending execution status
    YZG->>NATS: publish execution_requested.v1
    NATS->>YZR: durable delivery
    YZR->>NATS: publish execution_started/completed/failed
    NATS->>YZG: durable consume lifecycle events
    YZG->>Redis: persist execution status
    UI->>GW: GET /runtime/executions/:id (poll)
    GW->>YZG: proxy GET /runtime/executions/:id
    YZG->>Redis: read latest status
    GW-->>UI: pending/running/completed/failed
```

### Result Delivery Mode

- Current playground uses polling (`GET /runtime/executions/:id` every ~1s, max wait ~5m).
- Runtime gateway also exposes SSE stream endpoint (`/runtime/executions/stream`) for future UI use.

## Channel Account Management (admin-console)

The admin-console uses the account API surface exposed by gateway.

### Account CRUD Flow

```mermaid
sequenceDiagram
    autonumber
    participant UI as admin-console
    participant GW as api-gateway
    participant CH as channel-service
    participant DB as Tenant PostgreSQL

    UI->>GW: /channels/accounts (GET/POST/PATCH/DELETE)
    GW->>CH: proxy /channels/accounts
    CH->>DB: persist/read account state
    CH-->>GW: response
    GW-->>UI: response
```

### Notes

- Telegram bot token and provider credentials are sent via account APIs; storage ownership is in `channel-service`.

## References

- `services/admin-console/src/app/core/services/yoizenclaw-runtime.service.ts`
- `services/admin-console/src/app/features/automation/yoizenclaw/playground.component.ts`
- `services/admin-console/src/app/core/services/channel-admin.service.ts`
- `services/api-gateway/src/modules/runtime/runtime.controller.ts`
- `services/api-gateway/src/modules/channels/channels.controller.ts`
