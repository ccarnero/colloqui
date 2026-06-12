# Arquitectura: NATS Ingress Bus

**Estado:** Referencia del sistema implementado
**Audiencia:** Infra + Dev
**Fecha:** 2026-06-11 (actualizado desde borrador 2026-03-21)
**Proyecto:** platform-cluster

> **Nota:** Este documento describe el sistema **implementado**. La referencia operacional
> canónica del bus es [`DOCS/03-messaging.md`](../../../DOCS/03-messaging.md).
> El contrato fuente del envelope está en
> [`packages/shared/src/interfaces.ts`](../../../packages/shared/src/interfaces.ts).

---

## Contexto

Este conjunto de documentos define la arquitectura del bus de eventos basado en NATS JetStream para la plataforma. El bus recibe eventos de ingress desde providers externos (WhatsApp, Instagram, Telegram, etc.), agentes AI (internos, de terceros y de plataforma), y otros servicios de la plataforma.

El sistema ya está en producción como camino principal de ingress. El flujo de webhook externo pasa por un proceso en dos etapas: `api-gateway` publica un `WebhookIngressEnvelope` inicial (con el cuerpo raw y sin verificar), y `channel-service` consume ese evento, verifica la firma del provider, resuelve la cuenta y publica el envelope canónico en `INGRESS-<tenant>`.

---

## Documentos

| # | Documento | Descripción | Audiencia principal |
|---|-----------|-------------|---------------------|
| 01 | [Service Bus](./01-service-bus.md) | Arquitectura del bus basado en JetStream. Topología de streams por tenant, aislamiento, configuración, ciclo de vida y provisioning | Infra |
| 02 | [Diseño de Mensajes](./02-diseño-de-mensajes.md) | Contrato del envelope, diseño de subjects, abstracción de transporte, idempotencia, cadena causal, y ejemplos por tipo de fuente | Dev |
| 03 | [Ingress de Agentes](./03-ingress-agentes.md) | Tres categorías de agentes (interno, tercero, plataforma), pipelines por categoría, mecanismo anti-loop | Dev |
| 04 | [Claim Check](./04-claim-check.md) | Patrón para payloads grandes. NATS Object Store, umbrales, flujos inline vs referencia, diagramas de secuencia, y manejo de fallos | Dev + Infra |
| 05 | [Seguridad](./05-seguridad.md) | ACLs por tenant, verificación de firma por provider, política de PII, autenticación por tipo de agente, rate limiting y revocación | Infra + Seguridad |
| 06 | [Observabilidad](./06-observabilidad.md) | Métricas mínimas, estándares de logging, alertas recomendadas y dashboards sugeridos | Infra + Dev |

---

## Decisiones cerradas

Estas decisiones son finales y aplican transversalmente a todos los documentos.

| # | Decisión | Documento | Estado |
|---|----------|-----------|--------|
| D1 | Envelope genérico + raw payload intacto | 02 | Implementado |
| D2 | JetStream, no Core NATS | 01 | Implementado |
| D3 | 1 evento por POST raw recibido (no split) | 02 | Implementado |
| D4 | Routing por NATS subject, no por campos del body | 02 | Implementado |
| D5 | Un stream por tenant con limits explícitos | 01 | Implementado |
| D6 | Raw completo + ACL por tenant para PII | 05 | Implementado (ACLs pendientes de documentar) |
| D7 | Shadow publish inicial — reemplazado por camino primario | 01 | Superado: NATS es el camino primario |
| D8 | Allowlist explícito de headers HTTP | 02 | Implementado (6 headers; ver `WEBHOOK_FORWARDED_HEADERS`) |
| D9 | `traceid` en el envelope | 02 | Implementado (`activeOrRandomTraceId` via `@yoizen/observability`) |
| D10 | Renombrar campo `subject` a `resource` en el envelope | 02 | Implementado |
| D11 | `causation_id` y `correlation_id` en el envelope | 02 | Implementado |
| D12 | Mecanismo anti-loop con `depth` para agentes | 03 | Parcialmente implementado (ver nota en 02 §6.3) |
| D13 | Patrón Claim Check para payloads grandes | 04 | Implementado |
| D14 | NATS Object Store como store inicial del claim check | 04 | Implementado |
| D15 | Umbral de 256 KB para activar claim check | 04 | Implementado (`CLAIM_CHECK_THRESHOLD_BYTES`) |
| D16 | `max_payload` del servidor se mantiene en 1 MB (default) | 04 | Implementado |
| D17 | Tres categorías de agentes: interno, tercero, plataforma | 03 | Implementado parcialmente |

---

## Puntos abiertos consolidados

Los puntos marcados **Resuelto** están cerrados en código. Los demás siguen pendientes.

| # | Tema | Owner | Documento | Estado |
|---|------|-------|-----------|--------|
| O1 | Definir estructura de NATS accounts (1 por tenant vs 1 por env con ACLs) | Infra | 01 | Pendiente |
| O2 | Automatización de provisioning de tenants | Infra + Dev | 01 | **Resuelto** (3 capas: tenant-service, publishers lazy, agent-ai-service self-healing) |
| O3 | Allowlist de headers por provider | Dev | 02 | **Resuelto** (6 headers en `WEBHOOK_FORWARDED_HEADERS`, `channel.constants.ts:55`) |
| O4 | Esquema de `correlation_id` (formato, quién lo genera, propagación) | Dev | 02 | **Resuelto** (`correlation_id` defaults al propio `id` del envelope; se propaga sin cambios en `deriveEnvelope`) |
| O5 | Evaluar si `provider` debería ser opcional para canales single-provider | Dev | 02 | Pendiente |
| O6 | Definir contrato de transporte para providers basados en polling | Dev | 02 | Pendiente |
| O7 | Definir formato de Agent Cards para descubrimiento de capacidades | Dev | 03 | Pendiente |
| O8 | Evaluar MCP server como interfaz de publish para agentes internos | Dev | 03 | Pendiente |
| O9 | Diseñar API gateway para agentes de terceros | Dev + Infra | 03 | Pendiente |
| O10 | Definir proceso de onboarding de agentes de terceros | Dev + Producto | 03 | Pendiente |
| O11 | Definir integraciones con proveedores de plataforma AI | Dev | 03 | Pendiente |
| O12 | Evaluar A2A como protocolo de coordinación multi-agente | Dev | 03 | Pendiente |
| O13 | Definir max bucket size por tier | Infra | 04 | **Resuelto** (512 MB default, `CLAIM_CHECK_BUCKET_MAX_BYTES`) |
| O14 | Evaluar compresión del payload antes del store | Dev | 04 | Pendiente |
| O15 | Definir retry policy para fallos de escritura al Object Store | Dev | 04 | Pendiente |
| O16 | Definir configuración de encriptación at rest de JetStream | Infra | 05 | Pendiente |
| O17 | Definir política de rotación de API keys para agentes de terceros | Infra + Seguridad | 05 | Pendiente |
| O18 | Evaluar mecanismo de revocación inmediata de agentes de terceros | Infra | 05 | Pendiente |
| O19 | Definir estrategia de redacción de PII si cambian requerimientos de compliance | Dev + Legal | 05 | Pendiente |
| O20 | Definir dashboard de monitoreo para streams | Infra | 06 | Pendiente |
| O21 | Definir estrategia de dead-letter para validaciones fallidas | Dev | 06 | Parcialmente resuelto (DLQ-<tenant> existe; ver 01 §5) |

---

## Roadmap de milestones

| Milestone | Alcance | Estado |
|-----------|---------|--------|
| M1 | Ingress externo al bus como camino primario (WhatsApp, Telegram, etc.) | **Completado** |
| M2 | Agentes internos publican al bus via MCP server | Pendiente |
| M3 | Agentes de plataforma via integraciones directas | En curso |
| M4 | Agentes de terceros via API gateway + marketplace | Pendiente |
| M5 | Evaluación de A2A para coordinación multi-agente | Pendiente |

---

## Cómo leer estos documentos

Si sos de **Infra**, empezá por `01-service-bus.md` y `05-seguridad.md`. Después revisá `04-claim-check.md` por las implicancias de storage. La referencia operacional está en `DOCS/03-messaging.md`.

Si sos de **Dev**, empezá por `02-diseño-de-mensajes.md` que define el contrato. Las interfaces TypeScript en `packages/shared/src/interfaces.ts` son la fuente de verdad. Después `03-ingress-agentes.md` para los pipelines. `04-claim-check.md` cuando implementes el publish.

Si sos de **Seguridad**, `05-seguridad.md` es tu documento principal. Referenciá `03-ingress-agentes.md` para entender los perfiles de confianza por tipo de agente.
