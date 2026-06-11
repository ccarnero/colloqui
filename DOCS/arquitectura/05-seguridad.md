# 05 — Seguridad

**Estado:** Referencia operacional — sistema implementado
**Audiencia:** Infra + Seguridad
**Fecha:** 2026-06-11 (actualizado desde borrador 2026-03-21)

> **Referencia operacional as-built:** `DOCS/03-NATS-JETSTREAM.md`

---

## 1. Resumen

Este documento describe las capas de seguridad implementadas en el sistema de mensajería. Para cada área se distingue explícitamente el **estado actual** (lo que está en producción) del **diseño objetivo** (lo que está planificado pero no implementado).

---

## 2. Modelo de confianza

El bus tiene cuatro tipos de productores, cada uno con un nivel de confianza distinto:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Niveles de confianza                         │
│                                                                  │
│  ┌─────────────────┐  Verificamos firma del provider.            │
│  │ Provider externo │  No controlamos qué manda pero validamos   │
│  │ (trust: alto)    │  autenticidad e integridad.                │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  Nuestro código, nuestra infra.             │
│  │ Agente interno   │  Control total sobre comportamiento.        │
│  │ (trust: alto)    │                                             │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  SaaS conocido con SLAs y formatos          │
│  │ Agente plataforma│  documentados. No operamos pero             │
│  │ (trust: medio)   │  conocemos el proveedor.                    │
│  └─────────────────┘                                             │
│                                                                  │
│  ┌─────────────────┐  Código ajeno, infra ajena. Máximas         │
│  │ Agente tercero   │  restricciones. Tratamos como               │
│  │ (trust: bajo)    │  potencialmente hostil.                     │
│  └─────────────────┘                                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Aislamiento por tenant

### 3.1 Estado actual — servidor NATS single-account

El servidor NATS está configurado en modo **single-account sin accounts, users ni bloques de autorización**. La configuración completa se encuentra en `infrastructure/base/nats/configmap.yaml`:

```
listen: 0.0.0.0:4222
jetstream { store_dir: /data/jetstream; max_mem: 256MB; max_file: 50GB }
max_payload: 1MB
```

No hay cuentas NATS, ACLs ni usuarios definidos. El aislamiento entre tenants es **exclusivamente por convención de subject-prefix a nivel de aplicación**: todos los mensajes de un tenant se publican bajo `evt.<tenantId>.>` y cada servicio filtra por tenant vía el stream `INGRESS-<tenantId>` correspondiente.

### 3.2 Diseño objetivo (pendiente)

> **Estado: pendiente — no implementado**

El diseño original contempla aislamiento criptográfico via NATS accounts y ACLs por tenant:

```
┌──────────────────────────────────────────┐
│          NATS Account: acme              │
│                                          │
│  Publish:    ingress-service ✓           │
│              agente-cs-v2    ✓ (scoped)  │
│              partner-xyz     ✓ (scoped)  │
│              otro-tenant     ✗           │
│                                          │
│  Subscribe:  processor-acme  ✓           │
│              analytics-acme  ✓           │
│              partner-xyz     ✓ (limitado)│
│              globex-service  ✗           │
│                                          │
│  Stream:     INGRESS-acme    (aislado)   │
│  Bucket:     PAYLOAD-acme    (aislado)   │
└──────────────────────────────────────────┘
```

- **Publish:** solo el servicio de ingress puede publicar en `evt.{tenant}.>`
- **Subscribe:** solo servicios autorizados para ese tenant pueden subscribirse
- **Cross-tenant:** ningún account puede ver tráfico de otro tenant

Este diseño requiere configuración dinámica de NATS accounts (NKEYs/JWT) y está pendiente de implementación.

---

## 4. Verificación por tipo de productor

### 4.1 Providers externos — firma de webhook (implementado)

La verificación de firma ocurre en **channel-service** cuando consume el envelope `webhook_received` publicado por api-gateway. El flujo tiene dos etapas:

**Etapa 1 — api-gateway:** recibe el webhook HTTP y publica un envelope `webhook_received` a JetStream **antes de que ocurra la verificación de firma**. El envelope lleva el body crudo en `raw_body_b64` junto con los headers de firma en `forwarded_headers`.

**Etapa 2 — channel-service:** al consumir el envelope, verifica la firma antes de cualquier procesamiento canónico. Si falla → mensaje descartado. El payload nunca llega al bus principal sin firma verificada.

> **Nota sobre el límite de confianza:** el raw webhook está en JetStream durante el intervalo entre publicación y verificación. El stream `INGRESS-<tenant>` es interno; el riesgo es bajo en la configuración actual (single-account), pero debe revisarse cuando se implemente el aislamiento por accounts (§3.2).

**Headers de firma reenviados** (`packages/shared/src/channel.constants.ts:55-62`):

```
WEBHOOK_FORWARDED_HEADERS = [
  "content-type",
  "x-hub-signature-256",
  "x-hub-signature",
  "x-telegram-bot-api-secret-token",
  "x-request-id",
  "user-agent"
]
```

**Mecanismos implementados por provider:**

| Provider | Mecanismo | Header | Implementación |
|----------|-----------|--------|----------------|
| Meta (WhatsApp, Instagram) | HMAC-SHA256 con `timingSafeEqual` | `x-hub-signature-256` | `services/channel-service/src/providers/meta/meta-base.ts` |
| Telegram | `timingSafeEqual` contra secret token | `x-telegram-bot-api-secret-token` | `services/channel-service/src/providers/telegram/telegram.provider.ts:62-65` |

Para Telegram, un header ausente o vacío se rechaza directamente como `signature_mismatch` (no hace fallback al primer account activo) porque el token es el único mecanismo para identificar el bot remitente.

**Providers no implementados:**

> **Estado: pendiente — no implementado**
> TikTok y X/Twitter no tienen providers en el sistema. Las filas correspondientes del diseño original (HMAC-SHA256 `x-tiktok-signature` y HMAC-SHA1 `x-twitter-webhooks-signature`) no aplican hasta que se implementen esos providers.

### 4.2 Agentes internos — token de servicio

> **Estado: pendiente — no implementado**

El diseño contempla autenticación de agentes internos mediante tokens de servicio scoped al tenant:

```
authenticateServiceToken(token, tenant) -> Result<AgentIdentity, err>
```

No está implementado. Los servicios internos acceden a NATS sin autenticación explícita de identidad (consecuencia del modo single-account).

### 4.3 Agentes de terceros — API key + autorización de tenant

> **Estado: pendiente — no implementado**

Diseño objetivo:

1. **API key:** autentica al agente de tercero
2. **Autorización de tenant:** verifica permiso para publicar al subject solicitado

```
authenticateApiKey(apiKey, tenant) -> Result<AgentIdentity, err>
validateTenantAuthorization(agentId, tenant, subject) -> Result<ok, err>
```

Restricciones previstas (pendientes): rotación obligatoria cada 90 días, max payload 1 MB con claim-check a 256 KB, consumer dedicado, revocación en < 1 min.

### 4.4 Agentes de plataforma — OAuth2 / firma de callback

> **Estado: pendiente — no implementado**

```
verifyPlatformSignature(request, platformProvider) -> Result<ok, err>
```

---

## 5. Validación de payload e integridad

### 5.1 Estado actual

La validación en `webhook-ingress.service.ts` es estructural liviana:

- Verifica que el body parseado sea un objeto JSON no nulo ni array
- Si no lo es → retorna `{ status: "invalid_payload" }` sin publicar nada

**No se publica a ningún DLQ en caso de payload inválido.** El rechazo es silencioso (solo log de warning). La métrica disponible para detectar esto es `channel.webhook.requests` (total de requests recibidos) vs `channel.ingress.messages_published` (publicados exitosamente).

### 5.2 Diseño objetivo — DLQ en caso de payload inválido (pendiente)

> **Estado: pendiente — no implementado**

El diseño original contemplaba publicar a `dlq.{tenant}.ingress.invalid.v1` en caso de payload inválido. Esta funcionalidad no está implementada; actualmente solo se hace log y retorno temprano.

### 5.3 DLQ implementado — fallo permanente de consumer

El DLQ que sí existe es el **per-tenant DLQ stream** `DLQ-<tenantId>` con subject pattern `dlq.<tenantId>.>`. Se usa en dos rutas:

1. **Fallo permanente de consumer** (`packages/database/src/multi-tenant-consumer-manager.ts`): cuando un handler lanza `PermanentError`, el manager hace `term()` y republica el envelope original a `dlq.<tenantId>.<original-subject>` con headers:
   - `X-Dlq-Reason`
   - `X-Dlq-Stage`
   - `X-Dlq-Original-Subject`

2. **Fallo de claim-check store** (`services/channel-service/src/modules/ingress/ingress.service.ts`): cuando falla la escritura al Object Store del payload claim-check, se publica el envelope original (con payload inline) al DLQ con:
   - `X-Dlq-Reason: claim_check_store_failed`
   - `X-Dlq-Stage: ingress_claim_check`
   - `X-Dlq-Original-Subject`

### 5.4 Integridad del claim-check

Todo payload que supera el umbral de 256 KB pasa por el patrón claim-check (`packages/database/src/claim-check.ts`):

- **Productor** (channel-service ingress): calcula `sha256` sobre exactamente los bytes de `canonicalJson(payload)` y los almacena en el Object Store. El envelope slim lleva `payload_checksum = "sha256:<hex>"`.
- **Consumidor**: al resolver el claim-check, calcula `sha256` sobre los bytes crudos recuperados del Object Store y los compara con `payload_checksum`. Si no coinciden → lanza `ClaimCheckResolveError` con código `"checksum_mismatch"` → nak/backoff → DLQ tras `MAX_DELIVER`.

Tipos de error de resolución (`ClaimCheckErrorCode`): `ref_missing`, `ref_malformed`, `blob_not_found`, `checksum_mismatch`.

---

## 6. Política de PII

### 6.1 Regla implementada

`data.payload` **nunca se loguea**. La función `envelopeLogFields` en `packages/observability/src/envelope-logging.ts` extrae solo los campos de metadatos del envelope (`event_id`, `trace_id`, `causation_id`, `correlation_id`, `tenant`, `channel`, `provider`, `producer`, `domain`, `idempotency_key`, `depth`). El campo `data.payload` está deliberadamente ausente de `IStructuredLogFields`.

### 6.2 Encriptación

| Capa | Mecanismo | Estado |
|------|-----------|--------|
| Tránsito | TLS 1.3 entre nodos y clientes | Requerido en prod |
| Reposo (streams) | JetStream file encryption | Pendiente de configurar |
| Reposo (object store) | Hereda del stream | Pendiente de configurar |

### 6.3 Opciones de redacción para futuros requerimientos de compliance

La arquitectura soporta agregar un paso de redacción entre ingress y publish sin cambiar el contrato del envelope:

1. **Redacción selectiva:** stripear campos específicos del raw antes de publicar
2. **Doble publish:** versión completa al stream principal (ACL estricto) + versión redactada a stream público del tenant
3. **Redacción en Capa 2:** raw completo en Capa 1, consumer de Capa 2 produce eventos canónicos ya redactados

---

## 7. Rate limiting

### 7.1 Estado actual

No hay un mecanismo de rate limiting dedicado por tenant o agente implementado en el ingress. Los eventos rechazados por 429 son visibles en la métrica `http.server.request.total` con `status_code=429` (emitida por `packages/observability/src/http-metrics.ts`).

### 7.2 Diseño objetivo — rate limiting por tipo (pendiente)

> **Estado: pendiente — no implementado**

El diseño original contempla enforcement a nivel del servicio de ingress antes del publish:

| Tipo | Límite (msgs/seg) | Burst | Configurable |
|------|--------------------|-------|--------------|
| Provider externo (default) | 100 | 500 | Por tenant |
| Provider externo (enterprise) | 1000 | 5000 | Por tenant |
| Agente interno | 200 | 1000 | Por agente |
| Agente de tercero | 50 | 200 | Por contrato |
| Agente de plataforma | 100 | 500 | Por integración |

La métrica `ingress.rate_limited` prevista en el diseño no está implementada; los 429 se rastrean hoy vía `http.server.request.total{status_code="429"}`.

---

## 8. Seguridad por categoría de agente

### 8.1 Resumen de controles — estado actual vs diseño objetivo

| Control | Interno | Tercero | Plataforma |
|---------|---------|---------|------------|
| Autenticación | **Pendiente** (token de servicio) | **Pendiente** (API key + secret) | **Pendiente** (OAuth2 / firma) |
| Autorización | **Pendiente** (por subject scoped) | **Pendiente** (tenant debe autorizar) | **Pendiente** (por integración) |
| Validación de output | Estándar (implementado) | **Pendiente** (estricta 1 MB) | **Pendiente** |
| Rate limit | **Pendiente** | **Pendiente** | **Pendiente** |
| Rotación de credenciales | **Pendiente** | **Pendiente** (90 días) | **Pendiente** (OAuth2) |
| Revocación | **Pendiente** | **Pendiente** (< 1 min) | **Pendiente** |
| Anti-loop (MAX_DEPTH) | Definido (5) | **Pendiente** | **Pendiente** |

### 8.2 Agentes de terceros — sandbox de datos (diseño objetivo)

> **Estado: pendiente — no implementado**

Un agente de tercero NUNCA debe poder:

- Leer el stream completo del tenant
- Publicar a subjects no autorizados
- Ver eventos de otros agentes de terceros (salvo autorización explícita)
- Conocer la existencia de otros tenants

Un agente de tercero SOLO debe poder:

- Recibir eventos via consumer dedicado creado por el tenant
- Publicar a subjects explícitamente autorizados por el tenant
- Ver sus propios eventos publicados

### 8.3 Audit trail — estado actual

Los campos de log implementados en `packages/observability/src/envelope-logging.ts` (`IStructuredLogFields`) son: `event_id`, `trace_id`, `causation_id`, `correlation_id`, `tenant`, `channel`, `provider`, `producer`, `domain`, `idempotency_key`, `depth`, `step`.

Los campos de audit extendido para agentes (`agent_model`, `confidence`, `tool_chain`, `agent_vendor`, `api_key_id`, `origin_ip`, `platform_*`) **no están implementados**.

> **Estado: pendiente — no implementado**
> El audit trail extendido para agentes internos, de terceros y de plataforma (campos `agent_id`, `agent_category`, `confidence`, `tool_chain`, `agent_vendor`, `api_key_id`, `origin_ip`, etc.) está planificado pero no implementado en el logging estructurado actual.

---

## 9. Revocación de acceso

> **Estado: pendiente — no implementado**

El diseño de revocación por tipo de agente (rotación de webhook secrets, tokens de servicio, API keys, OAuth2) no está implementado como mecanismo centralizado. La revocación de webhook secrets se hace manualmente en el panel del provider externo (Meta, Telegram) y requiere actualizar el secreto configurado en el sistema.

| Tipo | Mecanismo previsto | Tiempo efectivo previsto |
|------|-----------|-----------------|
| Provider externo | Rotar webhook secret en el provider | Inmediato (webhooks nuevos fallan verificación) |
| Agente interno | Rotar token de servicio | Según cache de tokens (< 5 min) |
| Agente de tercero | Revocar API key via admin | < 1 minuto |
| Agente de plataforma | Revocar credenciales OAuth2 | Según token expiry (configurable) |
