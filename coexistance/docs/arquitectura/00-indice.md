# Arquitectura: NATS Ingress Bus

**Estado:** Borrador para revisión
**Audiencia:** Infra + Dev
**Fecha:** 2026-03-21
**Proyecto:** coexistance

---

## Contexto

Este conjunto de documentos define la arquitectura del bus de eventos basado en NATS JetStream para `coexistance`. El bus recibe eventos de ingress desde providers externos (WhatsApp, Instagram, TikTok, etc.), agentes AI (internos, de terceros, y de plataforma), y potencialmente otros orígenes futuros.

El primer milestone es un shadow publish en paralelo al flujo actual (Mongo + websocket). No se modifica ningún comportamiento existente.

---

## Documentos

| # | Documento | Descripción | Audiencia principal |
|---|-----------|-------------|---------------------|
| 01 | [Service Bus](./01-service-bus.md) | Arquitectura del bus basado en JetStream. Topología del cluster, streams por tenant, aislamiento por entorno, configuración, y ciclo de vida | Infra |
| 02 | [Diseño de Mensajes](./02-diseño-de-mensajes.md) | Contrato del envelope, diseño de subjects, abstracción de transporte, idempotencia, cadena causal, y ejemplos por tipo de fuente | Dev |
| 03 | [Ingress de Agentes](./03-ingress-agentes.md) | Tres categorías de agentes (interno, tercero, plataforma), pipelines por categoría, mecanismo anti-loop, relación con MCP y A2A, y roadmap de milestones | Dev |
| 04 | [Claim Check](./04-claim-check.md) | Patrón para payloads grandes. NATS Object Store, umbrales, flujos inline vs referencia, diagramas de secuencia, y manejo de fallos | Dev + Infra |
| 05 | [Seguridad](./05-seguridad.md) | ACLs por tenant, verificación de firma por provider, política de PII, autenticación por tipo de agente, rate limiting, y revocación | Infra + Seguridad |
| 06 | [Observabilidad](./06-observabilidad.md) | Métricas mínimas, estándares de logging, alertas recomendadas, y dashboards sugeridos | Infra + Dev |

---

## Decisiones cerradas

Estas decisiones son finales y aplican transversalmente a todos los documentos. No deben reabrirse sin una revisión formal de diseño.

| # | Decisión | Documento |
|---|----------|-----------|
| D1 | Envelope genérico + raw payload intacto | 02 |
| D2 | JetStream, no Core NATS | 01 |
| D3 | 1 evento por POST raw recibido (no split) | 02 |
| D4 | Routing por NATS subject, no por campos del body | 02 |
| D5 | Un stream por tenant con limits explícitos | 01 |
| D6 | Raw completo + ACL por tenant para PII | 05 |
| D7 | Shadow publish inicial (fire-and-forget) | 01 |
| D8 | Allowlist explícito de headers HTTP | 02 |
| D9 | `traceid` en el envelope | 02 |
| D10 | Renombrar campo `subject` a `resource` en el envelope | 02 |
| D11 | `causation_id` y `correlation_id` en el envelope | 02 |
| D12 | Mecanismo anti-loop con `depth` para agentes | 03 |
| D13 | Patrón Claim Check para payloads grandes | 04 |
| D14 | NATS Object Store como store inicial del claim check | 04 |
| D15 | Umbral de 256 KB para activar claim check | 04 |
| D16 | `max_payload` del servidor se mantiene en 1 MB (default) | 04 |
| D17 | Tres categorías de agentes: interno, tercero, plataforma | 03 |

---

## Puntos abiertos consolidados

| # | Tema | Owner | Documento |
|---|------|-------|-----------|
| O1 | Definir estructura de NATS accounts (1 por tenant vs 1 por env con ACLs) | Infra | 01 |
| O2 | Definir automatización de provisioning de tenants (stream + bucket) | Infra + Dev | 01 |
| O3 | Definir allowlist de headers por provider (empezar con Meta) | Dev | 02 |
| O4 | Definir esquema de `correlation_id` (formato, quién lo genera, propagación) | Dev | 02 |
| O5 | Evaluar si `provider` debería ser opcional para canales single-provider | Dev | 02 |
| O6 | Definir contrato de transporte para providers basados en polling | Dev | 02 |
| O7 | Definir formato de Agent Cards para descubrimiento de capacidades | Dev | 03 |
| O8 | Evaluar MCP server como interfaz de publish para agentes internos (M2) | Dev | 03 |
| O9 | Diseñar API gateway para agentes de terceros | Dev + Infra | 03 |
| O10 | Definir proceso de onboarding de agentes de terceros | Dev + Producto | 03 |
| O11 | Definir integraciones con proveedores de plataforma AI (primer candidato TBD) | Dev | 03 |
| O12 | Evaluar A2A como protocolo de coordinación multi-agente (M5) | Dev | 03 |
| O13 | Definir max bucket size por tier (default propuesto: 5 GB) | Infra | 04 |
| O14 | Evaluar compresión del payload antes del store (gzip/zstd) | Dev | 04 |
| O15 | Definir retry policy para fallos de escritura al Object Store | Dev | 04 |
| O16 | Definir configuración de encriptación at rest de JetStream | Infra | 05 |
| O17 | Definir política de rotación de API keys para agentes de terceros | Infra + Seguridad | 05 |
| O18 | Evaluar mecanismo de revocación inmediata de agentes de terceros | Infra | 05 |
| O19 | Definir estrategia de redacción de PII si cambian requerimientos de compliance | Dev + Legal | 05 |
| O20 | Definir dashboard de monitoreo para streams | Infra | 06 |
| O21 | Definir estrategia de dead-letter para validaciones fallidas | Dev | 06 |

---

## Roadmap de milestones

| Milestone | Alcance | Dependencias |
|-----------|---------|--------------|
| M1 | Shadow publish de ingress externo (WhatsApp) al bus. Convive con Mongo + websocket | 01, 02, 05, 06 |
| M2 | Agentes internos publican al bus via MCP server | 03 |
| M3 | Agentes de plataforma via integraciones directas | 03 |
| M4 | Agentes de terceros via API gateway + marketplace | 03, 05 |
| M5 | Evaluación de A2A para coordinación multi-agente | 03 |

---

## Cómo leer estos documentos

Si sos de **Infra**, empezá por `01-service-bus.md` y `05-seguridad.md`. Después revisá `04-claim-check.md` por las implicancias de storage.

Si sos de **Dev**, empezá por `02-diseño-de-mensajes.md` que define el contrato que vas a implementar. Después `03-ingress-agentes.md` para entender los pipelines. `04-claim-check.md` cuando implementes el publish.

Si sos de **Seguridad**, `05-seguridad.md` es tu documento principal. Referenciá `03-ingress-agentes.md` para entender los perfiles de confianza por tipo de agente.
