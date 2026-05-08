# Services — Mapa de comunicación

Esta guía describe cómo se comunican los servicios alojados en `services/`. La plataforma combina **HTTP síncrono** (a través del API Gateway), **mensajería asíncrona** sobre **NATS JetStream** (streams per-tenant `INGRESS-<tenant>` / `DLQ-<tenant>` y un `DLQ` global), **Core NATS** para eventos fire-and-forget (`platform.tenant.deleted`), **PostgreSQL por tenant** (tier Dedicated: StatefulSets dedicados; tier Shared: logical DB en CloudNativePG), **Redis** como cache compartida, y **Temporal** para orquestación de workflows.

> Resumen rápido: las consolas Angular (`admin-console`, `messaging-console`) hablan **solo** con el `api-gateway`. El gateway autentica vía `auth-service`, valida y publica eventos al stream `INGRESS-<tenant>` del tenant, y proxyea el resto de operaciones a sus servicios destino. El plano asíncrono es procesado por `event-processor`, `audit-service`, `metrics-service`, `webhook-service`, `channel-service` y `usage-aggregator-service`, todos consumiendo de streams `INGRESS-<tenant>`. La orquestación durable se hace con Temporal (`workflow-service` API + `workflow-service` worker como proceso separado + `http-adapter`).

---

## Convención de subjects NATS

Todos los subjects siguen un formato canónico de 8 tokens:

```
evt.<tenant>.<source>.<domain>.<area>.<kind>.<action>.v1
```

| Token | Descripción | Ejemplo |
|-------|-------------|---------|
| `evt` | Prefijo fijo | `evt` |
| `<tenant>` | ID del tenant | `acme` |
| `<source>` | Servicio que emite | `api-gateway`, `channel-service` |
| `<domain>` | Dominio de negocio | `platform`, `messaging` |
| `<area>` | Área funcional | `events`, `channel` |
| `<kind>` | Tipo de entidad/canal | `gateway`, `whatsapp` |
| `<action>` | Acción ocurrida | `received`, `send`, `completed` |
| `v1` | Versión del schema | `v1` |

> En este documento y en el diagrama Mermaid se usan formas abreviadas (p.ej. `evt.<t>.*.events.>`) por legibilidad. Consultar `packages/shared/src/channel.constants.ts` y `channel.utils.ts` para los patterns exactos.

---

## Diagrama de comunicación

```mermaid
flowchart LR
    %% =========================================================
    %% Clientes / consolas
    %% =========================================================
    subgraph CLIENTS["Clientes y consolas"]
        ADMIN["admin-console<br/>(Angular)"]
        MSG["messaging-console<br/>(Angular)"]
        EXT["Clientes externos<br/>+ webhooks entrantes"]
    end

    %% =========================================================
    %% Edge
    %% =========================================================
    GW["api-gateway<br/>(HTTP, JWT, SSE,<br/>dynamic routing)"]
    PROXY["proxy-service<br/>(generic / ySocial / yFlow)"]

    %% =========================================================
    %% Identidad y configuración del tenant
    %% =========================================================
    subgraph IDENTITY["Identidad y tenants"]
        AUTH["auth-service<br/>(JWT, users, clients,<br/>public routes)"]
        TENANT["tenant-service<br/>(K8s namespaces +<br/>Postgres por tenant)"]
        REG["registry-service<br/>(Knative registry,<br/>routes, canary)"]
    end

    %% =========================================================
    %% Configuración HTTP / Workflows
    %% =========================================================
    subgraph CONFIG["Configuración y workflows"]
        ADAPT["adapter-service<br/>(HTTP adapters +<br/>endpoints, AdapterClient)"]
        WF_API["workflow-service<br/>(Temporal client,<br/>API + worker separado)"]
        WF_HTTP["http-adapter<br/>(Temporal HTTP execution)"]
        SCHED["scheduler-service<br/>(cron / interval / one-time)"]
    end

    %% =========================================================
    %% Pipeline asíncrono de eventos
    %% =========================================================
    subgraph ASYNC["Pipeline asíncrono"]
        EP["event-processor<br/>(pipeline + handlers)"]
        AUD["audit-service<br/>(persistencia auditoría)"]
        MET["metrics-service<br/>(persistencia métricas)"]
        WHK["webhook-service<br/>(HTTP callbacks + DLQ)"]
        CACHE["cache-service<br/>(L1 in-memory + L2 Redis)"]
    end

    %% =========================================================
    %% Channels / mensajería con proveedores externos
    %% =========================================================
    subgraph CHANNELS["Channels (mensajería externa)"]
        CHN["channel-service<br/>(ingress / egress /<br/>webhooks Meta+Telegram)"]
        UAGG["usage-aggregator-service<br/>(Timescale por tenant)"]
    end

    %% =========================================================
    %% YoizenClaw (runtime conversacional)
    %% =========================================================
    subgraph YZ["YoizenClaw"]
        YZADMIN["yoizenclaw-admin-service<br/>(agents, jobs, credentials)"]
        YZRT["YoizenClaw runtime<br/>(consume config NATS)"]
    end

    %% =========================================================
    %% Infraestructura compartida
    %% =========================================================
    subgraph INFRA["Infraestructura"]
        NATS[("NATS JetStream<br/>INGRESS-«tenant» · DLQ-«tenant» · DLQ")]
        NATS_CORE[("Core NATS<br/>(pub/sub fire-and-forget)")]
        REDIS[("Redis<br/>(cache, results, public routes)")]
        PG_PLAT[("PostgreSQL plataforma<br/>(auth, registry)")]
        PG_TEN[("PostgreSQL por tenant<br/>(events, metrics, adapters,<br/>schedules, channels, usage)")]
        TMP[("Temporal Server")]
        K8S[("Kubernetes API")]
        EXT_HTTP["APIs externas<br/>(WhatsApp · Telegram · Meta ·<br/>HTTP adapters · webhooks)"]
    end

    %% =========================================================
    %% Edges: clientes -> gateway
    %% =========================================================
    ADMIN -- "HTTP + JWT" --> GW
    MSG   -- "HTTP + JWT" --> GW
    EXT   -- "HTTP" --> GW

    %% =========================================================
    %% Gateway -> servicios (HTTP proxy)
    %% =========================================================
    GW -- "HTTP /auth/*" --> AUTH
    GW -- "HTTP /tenants/*" --> TENANT
    GW -- "HTTP /registry/*<br/>+ poll /routes 15s" --> REG
    GW -- "HTTP /audit/*" --> AUD
    GW -- "HTTP /schedulers/*" --> SCHED
    GW -- "HTTP /workflows/*" --> WF_API
    GW -- "HTTP /adapters/*" --> ADAPT
    GW -- "HTTP /admin/*" --> YZADMIN
    GW -- "HTTP /channels/*<br/>+ webhooks" --> CHN
    GW -- "HTTP /proxy/*" --> PROXY
    GW -- "HTTP dynamic route" --> EXT_HTTP

    %% Gateway con la infra
    GW -- "publish evt.«t».api-gateway.*<br/>to INGRESS-«t»<br/>+ subscribe SSE" --> NATS
    GW -- "pending / result /<br/>public routes" --> REDIS

    %% =========================================================
    %% proxy-service
    %% =========================================================
    PROXY -- "HTTP GET /tenants/:id" --> TENANT
    PROXY -- "HTTP" --> EXT_HTTP

    %% =========================================================
    %% Identity stores
    %% =========================================================
    AUTH -- "users / clients /<br/>public routes" --> PG_PLAT
    AUTH -- "sync public routes" --> REDIS
    REG  -- "service registry +<br/>canary state" --> PG_PLAT
    REG  -- "create/patch ksvc" --> K8S
    REG  -- "publish service.*.v1<br/>(INGRESS-«t»)" --> NATS
    TENANT -- "create ns + StatefulSet(s)" --> K8S
    TENANT -- "publish platform.tenant.deleted" --> NATS_CORE

    %% =========================================================
    %% Pipeline asíncrono
    %% =========================================================
    NATS  -- "evt.«t».api-gateway.*<br/>(durable: event-processor)" --> EP
    NATS  -- "evt.«t».*.platform.*<br/>(durable: audit-events)" --> AUD
    NATS  -- "evt.«t».*.*.metrics.v1<br/>(durable)" --> MET
    EP    -- "publish evt.«t».event-processor.*.completed.v1<br/>(INGRESS-«t»)" --> NATS
    NATS  -- "evt.«t».event-processor.*<br/>(durable: webhook-dispatcher)" --> WHK
    WHK   -- "publish dlq.*<br/>(retries agotados)" --> NATS
    EP    -- "AdapterClient<br/>(HTTP + Redis SWR)" --> ADAPT
    EP    -- "«t»:result:«id»" --> REDIS
    WHK   -- "AdapterClient<br/>(HTTP + Redis SWR)" --> ADAPT
    WHK   -- "HTTP callbacks" --> EXT_HTTP
    AUD   -- "INSERT events" --> PG_TEN
    MET   -- "INSERT metrics" --> PG_TEN
    CACHE -- "L2" --> REDIS

    %% =========================================================
    %% Workflows (Temporal)
    %% =========================================================
    WF_API   -- "start / signal / query" --> TMP
    WF_HTTP  -- "poll task queue<br/>http-adapter" --> TMP
    WF_API   -- "publish servicebus<br/>(NATS)" --> NATS
    WF_HTTP  -- "AdapterClient<br/>(HTTP + Redis SWR)" --> ADAPT
    WF_HTTP  -- "tracedFetch" --> EXT_HTTP

    %% =========================================================
    %% Scheduler
    %% =========================================================
    SCHED -- "schedules + executions" --> PG_TEN
    SCHED -- "K8s Jobs (js-k8s / docker)" --> K8S

    %% =========================================================
    %% Channels
    %% =========================================================
    CHN -- "accounts / auto-reply /<br/>conversations" --> PG_TEN
    CHN -- "publish evt.«t».channel-service.<br/>messaging.*.*.received.v1<br/>(INGRESS-«t»)" --> NATS
    NATS -- "evt.*.channel-service.<br/>messaging.*.*.send.v1<br/>(durable: channel-egress)" --> CHN
    NATS -- "evt.*.api-gateway.<br/>messaging.*.webhook.*<br/>(durable: channel-webhook-ingress)" --> CHN
    CHN  -- "Send / Webhook<br/>WhatsApp · Meta · Telegram" --> EXT_HTTP

    %% =========================================================
    %% Usage aggregator
    %% =========================================================
    NATS  -- "INGRESS-* + DLQ-*<br/>(multi-tenant durable)" --> UAGG
    UAGG  -- "INSERT usage rollups<br/>(TimescaleDB)" --> PG_TEN

    %% =========================================================
    %% Adapter sync (registry -> adapter)
    %% =========================================================
    NATS  -- "service.upserted / deleted<br/>(durable: adapter-internal-sync)" --> ADAPT
    ADAPT -- "http_adapters + endpoints<br/>(per-tenant mirror)" --> PG_TEN

    %% =========================================================
    %% YoizenClaw
    %% =========================================================
    YZADMIN -- "agents / credentials /<br/>jobs / config_files" --> PG_TEN
    YZADMIN -- "publish evt.«t».<br/>yoizenclaw-admin.*" --> NATS
    YZADMIN -- "HTTP /adapters/*" --> ADAPT
    NATS    -- "config / job triggers" --> YZRT

    %% =========================================================
    %% Estilos
    %% =========================================================
    classDef edge fill:#0ea5e9,stroke:#0369a1,color:#fff
    classDef sync fill:#22c55e,stroke:#15803d,color:#fff
    classDef async fill:#f59e0b,stroke:#b45309,color:#fff
    classDef store fill:#64748b,stroke:#1e293b,color:#fff
    classDef ext fill:#a855f7,stroke:#6b21a8,color:#fff

    class GW,PROXY edge
    class AUTH,TENANT,REG,ADAPT,WF_API,WF_HTTP,SCHED,CACHE,YZADMIN sync
    class EP,AUD,MET,WHK,CHN,UAGG,YZRT async
    class NATS,NATS_CORE,REDIS,PG_PLAT,PG_TEN,TMP,K8S store
    class EXT,EXT_HTTP ext
```

---

## Diagrama de capas

```mermaid
flowchart LR
    subgraph FRONT["Frontends"]
        direction TB
        admin["admin-console"]
        msg["messaging-console"]
    end

    subgraph EDGE["Edge"]
        direction TB
        gw["api-gateway"]
        proxy["proxy-service"]
    end

    subgraph PLATFORM["Platform Services"]
        direction TB

        subgraph CORE["Core"]
            direction TB
            auth["auth-service"]
            tenant["tenant-service"]
            registry["registry-service"]
            adapter["adapter-service"]
            cache["cache-service"]
        end

        subgraph PIPE["Async Pipeline"]
            direction TB
            ep["event-processor"]
            audit["audit-service"]
            metrics["metrics-service"]
            webhook["webhook-service"]
            usage["usage-aggregator-service"]
        end

        subgraph ORCH["Automation / Orchestration"]
            direction TB
            wf["workflow-service"]
            wfhttp["http-adapter"]
            sched["scheduler-service"]
        end

        subgraph DOMAIN["Domain Services"]
            direction TB
            channel["channel-service"]
            yzadmin["yoizenclaw-admin-service"]
        end
    end

    subgraph SUPPORT["Support / Infrastructure"]
        direction TB

        subgraph BUS["Messaging"]
            direction TB
            nats["NATS JetStream"]
            natscore["Core NATS"]
        end

        subgraph STATE["State / Data"]
            direction TB
            redis["Redis"]
            pgplat["PostgreSQL platform"]
            pgten["PostgreSQL tenant"]
        end

        subgraph RUNTIME["Orchestration / Cluster"]
            direction TB
            temporal["Temporal"]
            k8s["Kubernetes API"]
        end

        subgraph EXT["External"]
            direction TB
            extapi["External APIs"]
        end
    end

    admin --> gw
    msg --> gw

    gw --> auth
    gw --> tenant
    gw --> registry
    gw --> audit
    gw --> adapter
    gw --> wf
    gw --> sched
    gw --> channel
    gw --> yzadmin
    gw --> proxy

    proxy --> tenant
    ep --> adapter
    webhook --> adapter
    wfhttp --> adapter
    yzadmin --> adapter

    gw -.-> nats
    gw -.-> redis
    proxy -.-> extapi

    auth -.-> pgplat
    auth -.-> redis

    tenant -.-> pgplat
    tenant -.-> k8s
    tenant -.-> natscore

    registry -.-> pgplat
    registry -.-> k8s
    registry -.-> nats

    adapter -.-> nats
    adapter -.-> pgten
    cache -.-> redis

    ep -.-> nats
    ep -.-> redis
    audit -.-> nats
    audit -.-> pgten
    metrics -.-> nats
    metrics -.-> pgten
    webhook -.-> nats
    webhook -.-> extapi
    usage -.-> nats
    usage -.-> pgten

    wf -.-> temporal
    wf -.-> nats
    wfhttp -.-> temporal
    wfhttp -.-> redis
    wfhttp -.-> extapi
    sched -.-> pgten
    sched -.-> k8s

    channel -.-> nats
    channel -.-> redis
    channel -.-> pgten
    channel -.-> extapi

    yzadmin -.-> nats
    yzadmin -.-> pgten

    classDef frontend fill:#e0f2fe,stroke:#0284c7
    classDef edge fill:#0ea5e9,stroke:#0369a1,color:#fff
    classDef core fill:#22c55e,stroke:#15803d,color:#fff
    classDef async fill:#f59e0b,stroke:#b45309,color:#fff
    classDef orch fill:#fb923c,stroke:#c2410c,color:#fff
    classDef domain fill:#a78bfa,stroke:#6d28d9,color:#fff
    classDef support fill:#64748b,stroke:#1e293b,color:#fff

    class admin,msg frontend
    class gw,proxy edge
    class auth,tenant,registry,adapter,cache core
    class ep,audit,metrics,webhook,usage async
    class wf,wfhttp,sched orch
    class channel,yzadmin domain
    class nats,natscore,redis,pgplat,pgten,temporal,k8s,extapi support

    style FRONT fill:#e0f2fe,stroke:#0284c7
    style EDGE fill:#0ea5e9,stroke:#0369a1,color:#fff
    style PLATFORM fill:#f8fafc,stroke:#94a3b8,color:#0f172a
    style CORE fill:#dcfce7,stroke:#15803d,color:#14532d
    style PIPE fill:#ffedd5,stroke:#c2410c,color:#7c2d12
    style ORCH fill:#ffedd5,stroke:#c2410c,color:#7c2d12
    style DOMAIN fill:#ede9fe,stroke:#6d28d9,color:#4c1d95
    style SUPPORT fill:#e2e8f0,stroke:#1e293b,color:#0f172a
    style BUS fill:#e2e8f0,stroke:#1e293b,color:#0f172a
    style STATE fill:#e2e8f0,stroke:#1e293b,color:#0f172a
    style RUNTIME fill:#e2e8f0,stroke:#1e293b,color:#0f172a
    style EXT fill:#e2e8f0,stroke:#1e293b,color:#0f172a
```

**Convención de flechas:** líneas sólidas = relación entre servicios de la plataforma; líneas punteadas = dependencia hacia servicios de soporte / infraestructura.

**Leyenda de capas:**

| Capa | Responsabilidad | Servicios |
|------|-----------------|-----------|
| **Frontends** | UIs Angular que hablan solo con el gateway | `admin-console`, `messaging-console` |
| **Edge** | Autenticación, routing, proxy HTTP | `api-gateway`, `proxy-service` |
| **Platform Core** | Identidad, tenants, config de adapters, cache | `auth-service`, `tenant-service`, `registry-service`, `adapter-service`, `cache-service` |
| **Async Pipeline** | Procesamiento de eventos, auditoría, métricas, webhooks | `event-processor`, `audit-service`, `metrics-service`, `webhook-service`, `usage-aggregator-service` |
| **Automation** | Workflows durables y scheduling | `workflow-service`, `http-adapter`, `scheduler-service` |
| **Channels** | Ingress/egress con proveedores de mensajería | `channel-service` |
| **YoizenClaw** | Plataforma conversacional (admin) | `yoizenclaw-admin-service` |
| **Support / Infrastructure** | Servicios managed/externos que la plataforma consume | NATS, Redis, PostgreSQL, Temporal, Kubernetes API, APIs externas |

---

## Secuencia: evento ingress → webhook callback

Este diagrama muestra el flujo principal de un evento desde que un cliente lo envía hasta que se dispara el callback HTTP al sistema externo.

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client (console / API)
    participant GW as api-gateway
    participant Redis as Redis
    participant NATS as NATS INGRESS-«t»
    participant EP as event-processor
    participant Adapter as adapter-service
    participant WH as webhook-service
    participant DLQ as NATS DLQ
    participant Ext as External API

    Client->>GW: POST /events (HTTP + JWT)
    activate GW
    GW->>GW: AuthGuard + TenantGuard
    GW->>Redis: SETEX «t»:pending:«id» (TTL 3600s)
    GW->>NATS: publish evt.«t».api-gateway.platform.events.gateway.«type».v1
    GW-->>Client: 202 Accepted { eventId }
    deactivate GW

    Note over NATS,EP: Durable consumer: event-processor<br/>Filter: evt.*.api-gateway.platform.events.gateway.>

    NATS->>EP: deliver message
    activate EP
    EP->>EP: Pipeline: validate → enrich → adapter-enrich → transform → forward

    opt adapterId present
        EP->>Adapter: GET /adapters/«adapterId»/endpoints/«endpointId» (AdapterClient + SWR)
        Adapter-->>EP: { auth, headers, timeout, retries, url }
    end

    EP->>Redis: SETEX «t»:result:«id» (payload + status)
    EP->>NATS: publish evt.«t».event-processor.platform.events.gateway.completed.v1
    EP-->>NATS: ACK
    deactivate EP

    Note over NATS,WH: Durable consumer: webhook-dispatcher<br/>Filter: evt.*.event-processor.platform.events.gateway.>

    NATS->>WH: deliver completion
    activate WH

    opt adapterId present
        WH->>Adapter: GET /adapters/«adapterId» (AdapterClient + SWR)
        Adapter-->>WH: { callbackUrl, auth, headers, timeout, maxRetries }
    end

    loop Retry with exponential backoff
        WH->>Ext: HTTP POST callback (auth headers + payload)
        alt 2xx response
            Ext-->>WH: 200 OK
            WH-->>NATS: ACK
        else non-2xx or timeout
            Ext-->>WH: 5xx / timeout
            Note over WH: sleep(backoffMs * 2^attempt)
        end
    end

    alt retries exhausted
        WH->>DLQ: publish dlq.«t».webhook.«id»
        WH-->>NATS: ACK
    end
    deactivate WH
```

**Puntos clave del flujo:**

1. El gateway es **fire-and-forget** para el cliente: responde `202` inmediato y el procesamiento es asíncrono.
2. El `event-processor` ejecuta un pipeline de 5 stages que puede enriquecer el evento con config del adapter.
3. El resultado se persiste en Redis para que el gateway lo pueda servir vía SSE o polling (`GET /events/:id/result`).
4. El `webhook-service` hace retry con backoff exponencial; si falla, el evento va a `DLQ` para reproceso manual.
5. Todo el flujo opera sobre el stream `INGRESS-<tenant>` — no hay streams intermedios.

---

## Catálogo de servicios

### Edge / front

| Servicio | Tipo | Habla con |
|----------|------|-----------|
| **`api-gateway`** | NestJS + Fastify (Knative) | Punto de entrada HTTP. JWT (`AuthGuard`), tenant guard (`TenantGuard`), SSE, **publica a NATS `INGRESS-<tenant>`** con subjects `evt.<t>.api-gateway.platform.events.gateway.<type>.v1`, lee resultados de Redis (`<t>:result:<id>`), proxyea a `auth`, `tenant`, `registry`, `audit`, `scheduler`, `workflow`, `adapter`, `yoizenclaw-admin`, `channel`, `proxy`. Polea `GET /routes` cada 15 s al `registry-service` para enrutar tráfico a Knative services del tenant. |
| **`proxy-service`** | NestJS + Fastify | Reenvía requests HTTP a sistemas externos (`generic` por header `x-proxy-target`, `ySocial` y `yFlow` por config del tenant). Solo consume `tenant-service` para resolver las URLs (cache `Map` 60 s, FIFO 512). |
| **`admin-console`** | Angular 21 | Consola tenant-scoped. Habla **solo** con `api-gateway` (login, dashboards, identity, automatización, integraciones, security). |
| **`messaging-console`** | Angular 21 | Consola de mensajería en tiempo real. Habla **solo** con `api-gateway` (cuentas de canal, conversaciones, auto-reply, event stream SSE). |

### Identidad y tenants

| Servicio | Habla con | Notas |
|----------|-----------|-------|
| **`auth-service`** | PostgreSQL plataforma + Redis | Login/credenciales, tokens HS256 (`jose`), users, clients, public-routes (sincroniza a Redis para que el gateway las lea). |
| **`tenant-service`** | Kubernetes API + Core NATS | Crea namespaces `<tenant>-<env>-ns` y provisiona PostgreSQL por tenant. **Tier Dedicated**: crea dos StatefulSets (OLTP Postgres + TimescaleDB para usage). **Tier Shared**: crea logical database en un cluster CloudNativePG compartido. Publica `platform.tenant.deleted` vía **Core NATS** (fire-and-forget pub/sub, no JetStream) para que otros servicios evicten caches/pools. |
| **`registry-service`** | Kubernetes API + PostgreSQL plataforma + NATS JetStream | Registra Knative services del tenant, define rutas, hace canary. Publica `service.upserted.v1` / `service.deleted.v1` en `INGRESS-<tenant>`; el `api-gateway` también consulta `GET /routes` cada 15 s. |

### Configuración y workflows

| Servicio | Habla con | Notas |
|----------|-----------|-------|
| **`adapter-service`** | PostgreSQL por tenant + NATS JetStream | Maneja la config multi-tenant de adapters HTTP y endpoints (auth, retries, headers, timeouts). Es consumido por `event-processor`, `webhook-service`, `http-adapter` vía `AdapterClient` (HTTP + cache SWR en Redis del lado del **cliente**) y por `yoizenclaw-admin-service` vía HTTP directo. Consume `service.upserted/deleted` del `registry-service` (durable: `adapter-internal-sync`) para mantener un mirror `http_adapters` por tenant. Nota: este servicio **no** usa Redis directamente; el SWR cache vive en los servicios consumidores. |
| **`workflow-service`** | Temporal + NATS | API REST (NestJS+Fastify) + Temporal worker como **proceso separado** (mismo image, entrypoints distintos: `dist/main.js` vs `dist/temporal/worker.js`, desplegados como Knative services `workflow-api` y `workflow-worker`). Despacha `endpointCall` y `serviceCall` al task queue `http-adapter` (worker remoto), ejecuta `agentCall`, `jsFunction`, `serviceBusCall` (publish NATS) y `branch` localmente en el worker propio. |
| **`http-adapter`** | Temporal + Redis + adapter-service | Worker Temporal dedicado al task queue `http-adapter`. Resuelve config vía `AdapterClient` (HTTP + Redis SWR), hace `tracedFetch` a APIs externas y resuelve `serviceCall` vía mirror interno o fallback a `registry-service`. |
| **`scheduler-service`** | PostgreSQL por tenant + Kubernetes API | Schedules `cron`, `interval`, `one-time`. Modos `js-inline` (Bun Worker en proceso), `js-k8s` (K8s Job con `oven/bun:1.3-alpine`) y `docker` (K8s Job con imagen custom). |

### Pipeline asíncrono de eventos

| Servicio | Stream / Consumer | Habla con |
|----------|-------------------|-----------|
| **`event-processor`** | `INGRESS-<tenant>` (durable: `event-processor`, filter: `evt.*.api-gateway.platform.events.gateway.>`) → publica completions a `INGRESS-<tenant>` | Pipeline ordenado (validation → enrichment → adapter-enrichment → transform → adapter-forward) y handler-registry vía `@EventType()`. Persiste `<tenant>:result:<id>` en Redis y publica `evt.<t>.event-processor.platform.events.gateway.completed.v1` en `INGRESS-<tenant>`. Usa `MultiTenantConsumerManager` que descubre dinámicamente streams `INGRESS-*`. |
| **`audit-service`** | `INGRESS-<tenant>` (durable: `audit-events`, filter: `evt.*.*.platform.>`) | Persiste cada envelope a la PostgreSQL del tenant; expone `GET /audit/events` paginado. Usa `MultiTenantConsumerManager`. |
| **`metrics-service`** | `INGRESS-<tenant>` (durable, filter: `evt.*.api-gateway.platform.events.gateway.metrics.v1`) | Persiste métricas por tenant en PostgreSQL. |
| **`webhook-service`** | `INGRESS-<tenant>` (durable: `webhook-dispatcher`, filter: `evt.*.event-processor.platform.events.gateway.>`), publica a `DLQ` | Hace los HTTP callbacks (retry exponencial con backoff). Si el evento trae `adapterId`, usa `AdapterClient` (HTTP + Redis SWR) para resolver auth/headers/retries/timeouts. |
| **`cache-service`** | Redis (L2) | Cache key/value con L1 in-memory + L2 Redis (cache-aside). No depende de NATS. |

### Channels (mensajería con proveedores externos)

| Servicio | Habla con | Notas |
|----------|-----------|-------|
| **`channel-service`** | NATS (`INGRESS-<tenant>`) + PostgreSQL por tenant + Redis + APIs externas | Tres responsabilidades: (1) **webhooks ingress** desde Meta/Telegram (recibe vía gateway, normaliza y publica en `INGRESS-<tenant>` con subject `evt.<t>.channel-service.messaging.<channel>.<provider>.received.v1`); (2) **egress** que consume `evt.*.channel-service.messaging.*.*.send.v1` (durable `channel-egress`, `max_deliver=2` para evitar duplicar mensajes a usuarios finales) y dispara HTTP a WhatsApp/Telegram/Instagram; (3) **auto-reply** + accounts CRUD. Consumer ingress: durable `channel-webhook-ingress` con filter `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1`. |
| **`usage-aggregator-service`** | NATS (`INGRESS-*` + `DLQ-*`) + Timescale por tenant | Worker multi-tenant: descubre dinámicamente streams `INGRESS-<TENANT>` / `DLQ-<TENANT>` y agrega rollups de uso a `postgres-usage` (TimescaleDB) por tenant. |

### YoizenClaw

| Servicio | Habla con | Notas |
|----------|-----------|-------|
| **`yoizenclaw-admin-service`** | PostgreSQL por tenant + NATS (publisher) + adapter-service (HTTP directo) | Backend admin de agentes, credenciales, jobs y config files de la plataforma conversacional YoizenClaw. Publica eventos `agent.published`, `credential.rotated`, `runtime.config.synced`, `job.triggered` en `INGRESS-<tenant>`. El runtime de YoizenClaw consume estos eventos para sincronizar configuración. No usa `AdapterClient` con SWR — llama al adapter-service directamente vía HTTP. No depende de tenant-service en runtime (routing a DB por convención de hostname). |

---

## Patrones de comunicación

### 1. HTTP síncrono a través del gateway

Los clientes (consolas y APIs externas) **nunca** llaman directamente a un servicio interno. Todo entra por `api-gateway`, que:

- valida JWT (`AuthGuard`) y resuelve tenant (`TenantGuard`),
- ejecuta proxies dedicados (`/auth`, `/tenants`, `/audit`, `/registry`, `/workflows`, `/schedulers`, `/adapters`, `/admin`, `/channels`, `/proxy`),
- para rutas no-plataforma, matchea contra el `DynamicRouteCacheService` (`Map<string, IRouteEntry[]>` ordenado por longest-prefix, refrescado cada 15 s) y proxea al Knative service del tenant.

### 2. Mensajería NATS JetStream

La plataforma usa streams **per-tenant** como modelo principal:

| Stream | Subjects | Productores principales | Consumers |
|--------|----------|-------------------------|-----------|
| `INGRESS-<tenant>` | `evt.<tenant>.>` | `api-gateway`, `event-processor`, `channel-service`, `registry-service`, `yoizenclaw-admin-service` | `event-processor`, `audit-service`, `metrics-service`, `webhook-service`, `channel-service` (egress + webhook-ingress), `adapter-service` (sync), `usage-aggregator-service`, `YoizenClaw runtime` |
| `DLQ` | `dlq.>` | `webhook-service` (deliveries fallidas) | observabilidad / reproceso manual |
| `DLQ-<tenant>` | `dlq.<tenant>.>` | per-tenant DLQ | `usage-aggregator-service` |

Convenciones clave:
- Durable consumers nombrados, ack explícito
- `max_deliver` ajustado por flujo (5 por defecto, 2 en egress de canales para no spamear usuarios finales)
- Backoff alineado con `ack_wait`
- `MultiTenantConsumerManager` descubre streams dinámicamente por regex (`/^INGRESS-/`, `/^DLQ-/`)

Adicionalmente, **Core NATS** (pub/sub sin persistencia) se usa para:

| Subject | Productor | Consumidores | Propósito |
|---------|-----------|--------------|-----------|
| `platform.tenant.deleted` | `tenant-service` | Todos los servicios con pools por tenant | Fire-and-forget: evictar caches y pools de conexiones DB |

### 3. Persistencia

- **PostgreSQL plataforma**: usado por `auth-service` y `registry-service` para datos cross-tenant (users, clients, registry, canary state).
- **PostgreSQL por tenant** — provisionado por `tenant-service`:
  - **Tier Dedicated**: StatefulSet OLTP dedicado (`postgres.<tenant>-<env>-ns.svc.cluster.local`) + StatefulSet TimescaleDB para usage.
  - **Tier Shared**: Logical database en un cluster CloudNativePG compartido.
  - Usado por: `audit-service`, `metrics-service`, `scheduler-service`, `adapter-service`, `channel-service`, `usage-aggregator-service` y `yoizenclaw-admin-service`.
  - Cada servicio mantiene un `Map<string, Sql>` con pools por tenant y se suscribe a `platform.tenant.deleted` (Core NATS) para evictar pools cuando se elimina un tenant.
- **Redis**: cache compartida (`<tenant>:pending:<id>`, `<tenant>:result:<id>`, `callback:<id>`, public-routes, adapter SWR cache en clientes, OAuth2 tokens).

### 4. Workflows durables

`workflow-service` se despliega como **dos procesos separados** (mismo image, distinto entrypoint):
- **`workflow-api`** (`dist/main.js`): API REST NestJS + cliente Temporal (start/signal/query workflows).
- **`workflow-worker`** (`dist/temporal/worker.js`): Worker Temporal que ejecuta las activities locales (`jsFunction`, `serviceBusCall`, `branch`).

Las acciones `endpointCall` y `serviceCall` se despachan al task queue `http-adapter`, donde **`http-adapter`** (servicio independiente) las ejecuta con `tracedFetch`, resolución vía `AdapterClient` y fallback a `registry-service` cuando corresponde. `agentCall`, `serviceBusCall` y `branch` permanecen en `workflow-worker`.

### 5. Adapter sync

`registry-service` publica `service.upserted.v1` / `service.deleted.v1` en `INGRESS-<tenant>` después del commit. El `adapter-service` mantiene un consumer durable (`adapter-internal-sync`) que materializa esos eventos en una tabla mirror `http_adapters` por tenant. El resto de servicios consume esa config a través de `AdapterClient` (HTTP + cache SWR en Redis **del lado del cliente**), sin hablar nunca con la base del registry.

---

## Quién depende de quién (resumen)

| Servicio | Depende sincrónicamente (HTTP) | Produce a NATS | Consume de NATS | Persistencia |
|----------|-------------------------------|----------------|-----------------|--------------|
| `api-gateway` | auth, tenant, registry, audit, scheduler, workflow, adapter, yoizenclaw-admin, channel, proxy, ksvc dinámicos | `evt.<t>.api-gateway.*` → `INGRESS-<t>` | `evt.<t>.>` (SSE) | Redis |
| `proxy-service` | tenant-service | — | — | — |
| `auth-service` | — | — | — | PG plataforma + Redis |
| `tenant-service` | Kubernetes API | `platform.tenant.deleted` (Core NATS) | — | PG plataforma |
| `registry-service` | Kubernetes API | `service.{upserted,deleted}.v1` → `INGRESS-<t>` | — | PG plataforma |
| `adapter-service` | — | — | `service.{upserted,deleted}.v1` (durable: adapter-internal-sync) | PG por tenant |
| `event-processor` | adapter-service (via AdapterClient) | `evt.<t>.event-processor.*.completed.v1` → `INGRESS-<t>` | `evt.<t>.api-gateway.platform.events.gateway.>` (durable: event-processor) | Redis |
| `audit-service` | — | — | `evt.<t>.*.platform.>` (durable: audit-events) | PG por tenant |
| `metrics-service` | — | — | `evt.<t>.*.*.*.metrics.v1` (durable) | PG por tenant |
| `webhook-service` | adapter-service (via AdapterClient) + URLs externas | `dlq.*` | `evt.<t>.event-processor.platform.events.gateway.>` (durable: webhook-dispatcher) | Redis (SWR en AdapterClient) |
| `cache-service` | — | — | — | Redis |
| `scheduler-service` | Kubernetes API | — | — | PG por tenant |
| `workflow-service` | Temporal | servicebus subjects → NATS | — | Temporal |
| `http-adapter` | Temporal + adapter-service (via AdapterClient) + registry-service + URLs externas | — | — | Redis (SWR en AdapterClient) |
| `channel-service` | APIs Meta/Telegram | `evt.<t>.channel-service.messaging.*` → `INGRESS-<t>` | `*.send.v1` (durable: channel-egress), `*.webhook_received.v1` (durable: channel-webhook-ingress) | PG por tenant + Redis |
| `usage-aggregator-service` | — | — | `INGRESS-*` + `DLQ-*` (multi-tenant discovery) | PG por tenant (Timescale) |
| `yoizenclaw-admin-service` | adapter-service (HTTP directo) | `evt.<t>.yoizenclaw-admin.*` → `INGRESS-<t>` | — | PG por tenant |

---

Para detalles internos (módulos, DTOs, esquemas, métricas) consultar `services/<service>/AGENTS.md` o `services/<service>/README.md`. Para el flujo end-to-end de eventos, ver `DOCS/README.md`.
