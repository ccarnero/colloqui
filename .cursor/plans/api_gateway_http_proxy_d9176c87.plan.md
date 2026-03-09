---
name: API Gateway HTTP Proxy
overview: Add a centralized ServiceRegistry and HTTP reverse proxy to the API Gateway so it can forward traditional HTTP request/response to downstream services (audit, cache, metrics) using `@fastify/http-proxy` for maximum performance.
todos: []
isProject: false
---

# API Gateway HTTP Request/Response with Service Registry

## Current State

The API Gateway currently handles:

- **Event publishing** via NATS (`POST /events`, `GET /results/:id`, `GET /events/stream`)
- **Audit proxy** via a dedicated `AuditProxyService` using `fetch` (hardcoded to audit-service)
- **Health checks** using a hardcoded `SERVICE_URLS` Map in [health.controller.ts](services/api-gateway/src/modules/health/health.controller.ts)

There is no centralized service registry and no generic HTTP proxying.

## Goal

Create a **ServiceRegistry** that knows about all downstream services and use `@fastify/http-proxy` to forward HTTP requests by path prefix to the corresponding service.

```mermaid
flowchart LR
    Client -->|HTTP| GW["API Gateway :3000"]
    
    subgraph nestjs [NestJS Controllers]
        Events["POST /events"]
        Results["GET /results/:id"]
        SSE["GET /events/stream"]
        Health["GET /health"]
    end

    subgraph proxy ["@fastify/http-proxy"]
        Audit["/audit/*"]
        Cache["/cache/*"]
        Metrics["/metrics/*"]
    end

    GW --> nestjs
    GW --> proxy

    Audit -->|HTTP| AuditSvc["audit-service"]
    Cache -->|HTTP| C
```



