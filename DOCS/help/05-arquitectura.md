# Arquitectura — Yoizen Platform

> Para la documentación canónica de arquitectura ver `DOCS/arquitectura/`. Este documento es un resumen orientativo.

## Estructura del monorepo

```
platform-cluster/
├── services/                   ← Microservicios (NestJS/Bun, Python)
│   ├── api-gateway/            ← Entry point HTTP, auth, tenant resolution, proxy
│   ├── auth-service/           ← JWT, usuarios, clientes, roles
│   ├── channel-service/        ← Webhook ingress/egress, providers WhatsApp/Instagram/Telegram
│   ├── tenant-service/         ← Provisioning K8s + Postgres per-tenant
│   ├── registry-service/       ← Knative service registry + dynamic routing
│   ├── audit-service/          ← Audit log de eventos
│   ├── scheduler-service/      ← Jobs programados
│   ├── workflow-service/       ← Temporal workflows
│   ├── agent-ai-service/       ← Pipeline de AI agents
│   ├── agent-admin-service/    ← Admin de agents (config, skills, knowledge bases)
│   ├── ai-agent-gateway/       ← Gateway de AI agents
│   ├── adapter-service/        ← Adaptadores HTTP con auth, retry, circuit breaker
│   ├── admin-console/          ← Frontend Angular (administración)
│   ├── messaging-console/      ← Frontend Angular (mensajería)
│   └── ...
│
├── packages/                   ← Librerías compartidas (workspace)
│   ├── shared/                 ← Tipos, interfaces, constantes cross-service
│   ├── database/               ← Helpers de DB: ensureStream, claim-check, migrations
│   ├── observability/          ← OpenTelemetry, Pino logger, NATS spans
│   └── ...
│
├── infrastructure/             ← Kustomize overlays por entorno
├── scripts/                    ← Scripts operacionales
└── bootstrap-orbstack.sh       ← Setup completo del cluster local
```

## Servicios core del pipeline de mensajería

| Servicio | Responsabilidad | Producer NATS |
|----------|----------------|---------------|
| `api-gateway` | Recibe webhooks, publica `WebhookIngressEnvelope` | `api-gateway` |
| `channel-service` | Verifica HMAC, parsea, publica `ChannelEnvelope` canónico; egress | `channel-service` |
| `registry-service` | Publica eventos de plataforma (registro de servicios) | `registry-service` |
| `agent-admin-service` | Publica eventos de configuración de agents | `agent-admin-service` |
| `ai-agent-gateway` | Publica eventos del pipeline de AI | `ai-agent-gateway` |

## Infraestructura

| Componente | Tecnología | Propósito |
|-----------|-----------|-----------|
| Orquestación | Kubernetes (OrbStack / minikube en dev) | Deploy y scaling |
| Serverless | Knative Serving | Scale-to-zero para servicios |
| Bus de eventos | NATS JetStream | Pub/sub durable per-tenant |
| Cache | Redis | Auth tokens, results, circuit breakers |
| Base de datos | Postgres per-tenant (K8s StatefulSet) | Datos del tenant |
| Observabilidad | OpenTelemetry + Pino | Traces, logs |
| Ingress | Kourier (Knative) | Enrutamiento HTTP |

## Flujo de ingreso de mensajes (resumen)

```
Provider externo (Meta/Telegram)
  │
  ▼
[api-gateway]  POST /webhooks/:channel/:tenantId
  │  WebhookIngressEnvelope → INGRESS-<TENANT>
  │  (sin accountid, sin verificación de firma)
  ▼
[channel-service]  consumer durable
  │  verifica HMAC/token, resuelve ChannelAccount
  │  ChannelEnvelope → INGRESS-<TENANT>
  │  (con accountid, firma verificada)
  ▼
Consumers downstream
  ├── [channel-service/auto-reply]  reglas de respuesta automática
  ├── [agent-ai-service]             pipeline de AI
  ├── [workflow-service]             Temporal workflows
  └── otros...
```

## Subjects NATS

Formato canónico (8 tokens):
```
evt.<tenant>.<producer>.messaging.<channel>.<provider>.<kind>.v1
```

Pre-ingress (api-gateway):
```
evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1
```

Canónico (channel-service):
```
evt.<tenant>.channel-service.messaging.whatsapp.meta.received.v1
evt.<tenant>.channel-service.messaging.instagram.meta.received.v1
evt.<tenant>.channel-service.messaging.telegram.telegram.received.v1
evt.<tenant>.channel-service.messaging.whatsapp.meta.sent.v1
```

Ver `DOCS/arquitectura/02-diseño-de-mensajes.md` para el contrato completo.

## Multi-tenancy

- Un cluster, múltiples tenants
- NATS: streams per-tenant (`INGRESS-<TENANT>`, `DLQ-<TENANT>`, `PAYLOAD-<TENANT>`)
- Postgres: StatefulSet dedicado por tenant en su namespace K8s (`<tenant>-dev-ns`)
- HTTP: header `x-yoizen-tenant` en todas las llamadas
- JWT scope: `tenant:<name>` para operadores; `platform` para servicios internos
- No hay ACLs de NATS — el aislamiento es de aplicación

## Packages relevantes

| Package | Propósito |
|---------|-----------|
| `@yoizen/shared` | Tipos `EventEnvelope`, `ChannelEnvelope`, `WebhookIngressEnvelope`; constantes de subjects, streams, headers |
| `@yoizen/database` | `ensureTenantIngressStream`, `ensureTenantDlqStream`, claim-check helpers |
| `@yoizen/observability` | `PinoLoggerService`, spans NATS, `activeOrRandomTraceId` |
