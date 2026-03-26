# 02 — Diseño de Mensajes

**Estado:** Borrador para revisión
**Audiencia:** Dev
**Fecha:** 2026-03-21

---

## 1. Resumen

Este documento define el contrato de los mensajes que viajan por el bus: el diseño de subjects para routing, el envelope con metadata estable, la abstracción de transporte, la cadena causal, y la idempotencia. Es el documento principal para desarrolladores que implementen el publish o consuman del bus.

---

## 2. Principios de diseño

- **Envelope genérico + raw payload intacto:** el bus transporta eventos sin interpretar el payload del provider. La lógica de negocio vive en los consumers, no en el bus
- **Routing por subject:** las decisiones de routing se toman por el NATS subject, no parseando el body del mensaje
- **1 evento por ingress:** cada POST/request/mensaje del provider genera exactamente un evento en el bus. Si hay múltiples items lógicos dentro (e.g., Meta manda varios mensajes + statuses en un POST), el split es responsabilidad de Capa 2
- **Trazabilidad completa:** cada evento lleva trace ID, causation ID, y correlation ID para reconstruir cadenas causales

---

## 3. Diseño de subjects

### 3.1 Formato

```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1
```

Cada token tiene un propósito:

| Token | Descripción | Ejemplos |
|-------|-------------|----------|
| `evt` | Prefijo fijo. Identifica eventos (vs comandos u otros tipos) | siempre `evt` |
| `tenant` | Identificador del tenant | `acme`, `globex` |
| `producer` | Servicio que publica el evento | `coexistance` |
| `domain` | Dominio de negocio | `messaging` |
| `channel` | Canal de comunicación | `whatsapp`, `instagram`, `tiktok`, `email` |
| `provider` | Proveedor de infraestructura del canal | `meta`, `bytedance`, `internal`, `thirdparty`, `openai` |
| `kind` | Tipo de evento | `ingress`, `agent_outbound`, `agent_action`, `agent_observation` |
| `v1` | Versión del contrato | `v1`, `v2` |

> **`env` no vive en el subject.** El entorno se separa por NATS account o cluster (ver doc 01).

### 3.2 Ejemplos por fuente

**Providers externos:**
```
evt.acme.coexistance.messaging.whatsapp.meta.ingress.v1
evt.acme.coexistance.messaging.instagram.meta.ingress.v1
evt.acme.coexistance.messaging.tiktok.bytedance.ingress.v1
evt.acme.coexistance.messaging.telegram.telegram.ingress.v1
evt.acme.coexistance.messaging.email.sendgrid.ingress.v1
```

**Agentes internos:**
```
evt.acme.coexistance.messaging.whatsapp.internal.agent_outbound.v1
evt.acme.coexistance.messaging.webchat.internal.agent_action.v1
```

**Agentes de terceros:**
```
evt.acme.coexistance.messaging.whatsapp.thirdparty.agent_outbound.v1
```

**Agentes de plataforma:**
```
evt.acme.coexistance.messaging.whatsapp.openai.agent_outbound.v1
evt.acme.coexistance.messaging.whatsapp.anthropic.agent_action.v1
```

### 3.3 Wildcard subscriptions

NATS soporta dos tipos de wildcards:

- `*` — match un token exacto
- `>` — match uno o más tokens (solo al final)

```
evt.acme.coexistance.messaging.>              -- todo messaging para acme
evt.acme.coexistance.messaging.whatsapp.>     -- todo whatsapp para acme
evt.*.coexistance.messaging.>                 -- todo messaging, todos los tenants
evt.acme.coexistance.messaging.*.internal.>   -- todo lo generado por agentes internos para acme
evt.acme.coexistance.messaging.*.*.ingress.v1 -- todo ingress externo para acme
```

### 3.4 Channel + provider redundante

Cuando channel y provider son la misma entidad (e.g., Telegram), el valor se repite: `telegram.telegram`. Esto es aceptable y mantiene la estructura del subject predecible. No omitir el token de provider.

### 3.5 Kinds de evento

| Kind | Descripción | Quién publica |
|------|-------------|---------------|
| `ingress` | Evento entrante desde provider externo | Ingress service |
| `agent_outbound` | Mensaje generado por un agente para enviar | Agente (cualquier categoría) |
| `agent_action` | Acción decidida por un agente (clasificar, escalar, etc.) | Agente (cualquier categoría) |
| `agent_observation` | Observación o análisis generado por un agente | Agente (cualquier categoría) |

---

## 4. Contrato del envelope

Inspirado en CloudEvents 1.0, adaptado para el bus interno.

### 4.1 Campos requeridos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `specversion` | string | Siempre `"1.0"` |
| `id` | string | ID único del evento. ULID recomendado |
| `source` | string | URI del servicio + endpoint que produce el evento |
| `type` | string | Tipo de evento en notación reverse-domain |
| `resource` | string | Identifica el recurso al que aplica el evento |
| `time` | string | Timestamp ISO 8601 de creación del evento |
| `traceid` | string | Trace ID de OpenTelemetry para correlación cross-service |
| `causation_id` | string \| null | ID del evento que causó este. `null` si es raíz |
| `correlation_id` | string | ID del flujo de negocio al que pertenece |
| `tenant` | string | Identificador del tenant |
| `producer` | string | Servicio que publicó el evento |
| `domain` | string | Dominio de negocio |
| `channel` | string | Canal de comunicación |
| `provider` | string | Proveedor de infraestructura |
| `accountid` | string | ID de cuenta del provider dentro del tenant |
| `idempotencykey` | string | Clave determinística para deduplicación |
| `transport` | object | Metadata del transporte (ver sección 5) |
| `data` | object | Contiene `received_at`, `payload` (o referencia), y metadata de tamaño |

### 4.2 Ejemplo completo — ingress de WhatsApp

```json
{
  "specversion": "1.0",
  "id": "01JQXXXX",
  "source": "/services/coexistance/ingress/meta/whatsapp",
  "type": "io.yoizen.messaging.ingress.received.v1",
  "resource": "tenant/acme/account/69bea8cd/channel/whatsapp/provider/meta",
  "time": "2026-03-21T15:40:11.382Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "conv_acme_wa_5551234_20260321",
  "tenant": "acme",
  "producer": "coexistance",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:a1b2c3d4...",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "headers": {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=..."
    }
  },
  "data": {
    "received_at": "2026-03-21T15:40:11.382Z",
    "payload_inline": true,
    "payload_ref": null,
    "payload_bytes": 3200,
    "payload_checksum": "sha256:a1b2c3...",
    "payload": {
      "object": "whatsapp_business_account",
      "entry": [{ "...": "raw meta body" }]
    }
  }
}
```

---

## 5. Abstracción de transporte

El campo `transport` describe cómo llegó el evento al sistema. Los únicos campos requeridos son `method` y `protocol`. El resto es específico de cada método.

### 5.1 Tipos de transporte

| Método | Protocolo | Descripción |
|--------|-----------|-------------|
| `webhook` | `https` | HTTP POST desde el provider |
| `poll` | `https` | El servicio consulta la API del provider |
| `stream` | `wss` | Conexión persistente websocket |
| `queue_bridge` | `amqp` | Bridge desde otro broker |
| `agent` | `internal` | Agente AI interno |
| `agent` | `thirdparty` | Agente AI de tercero |
| `agent` | `platform` | Agente AI de plataforma |

### 5.2 Ejemplos por tipo

**Webhook:**
```json
{
  "method": "webhook",
  "protocol": "https",
  "headers": {
    "content-type": "application/json",
    "x-hub-signature-256": "sha256=..."
  }
}
```

**Polling:**
```json
{
  "method": "poll",
  "protocol": "https",
  "poll_source": "https://api.provider.com/v1/messages",
  "poll_cursor": "cursor_abc123"
}
```

**Websocket:**
```json
{
  "method": "stream",
  "protocol": "wss",
  "connection_id": "conn_xyz"
}
```

**Queue bridge:**
```json
{
  "method": "queue_bridge",
  "protocol": "amqp",
  "source_queue": "provider.events",
  "delivery_tag": "dt_12345"
}
```

**Agente (ver doc 03 para detalle de cada categoría):**
```json
{
  "method": "agent",
  "protocol": "internal",
  "agent_id": "cs-agent-v2",
  "agent_model": "claude-sonnet-4-6",
  "depth": 1
}
```

### 5.3 Headers allowlist (webhook)

Solo los siguientes headers se capturan. Todos los demás se descartan antes de publicar.

```
content-type
x-hub-signature-256
x-hub-signature
x-request-id
user-agent
```

Esta lista es configurable por provider. Cada módulo de ingress declara su propio allowlist.

---

## 6. Campo `data`

### 6.1 Estructura

El campo `data` contiene el payload y metadata de tamaño. Soporta dos modos: inline (payload en el mensaje) y claim check (payload por referencia). Ver doc 04 para el patrón completo.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `received_at` | string | Timestamp ISO 8601 de recepción |
| `payload_inline` | boolean | `true` si el payload viaja en `payload` |
| `payload_ref` | string \| null | URI de referencia al Object Store. `null` si inline |
| `payload_bytes` | number | Tamaño en bytes del payload original |
| `payload_checksum` | string | SHA256 del payload para verificación de integridad |
| `payload` | object \| null | Raw payload cuando viaja inline. `null` si claim check |

### 6.2 Inline (caso común)

```json
{
  "data": {
    "received_at": "2026-03-21T15:40:11.382Z",
    "payload_inline": true,
    "payload_ref": null,
    "payload_bytes": 3200,
    "payload_checksum": "sha256:a1b2c3...",
    "payload": { "...": "raw body" }
  }
}
```

### 6.3 Claim check (payload grande)

```json
{
  "data": {
    "received_at": "2026-03-21T15:40:12.100Z",
    "payload_inline": false,
    "payload_ref": "nats://objstore/PAYLOAD-acme/01JQYYYY-payload",
    "payload_bytes": 358400,
    "payload_checksum": "sha256:d4e5f6...",
    "payload": null
  }
}
```

---

## 7. Cadena causal y correlación

### 7.1 `causation_id`

Apunta al `id` del evento que directamente causó este evento. Si un agente consume un evento de ingress y genera una respuesta, el `causation_id` de la respuesta es el `id` del ingress original.

Si el evento es raíz (webhook que llega sin trigger previo), el valor es `null`.

### 7.2 `correlation_id`

Identifica el flujo de negocio completo al que pertenece el evento. Todos los eventos de una misma conversación, ticket, o transacción comparten el mismo `correlation_id`. Se propaga sin modificarse a lo largo de toda la cadena.

### 7.3 Ejemplo de cadena

```
Evento A: ingress de WhatsApp
  id: "evt_001"
  causation_id: null           (raíz)
  correlation_id: "conv_123"

      ↓ agente consume A y decide responder

Evento B: agente outbound
  id: "evt_002"
  causation_id: "evt_001"      (causado por A)
  correlation_id: "conv_123"   (misma conversación)

      ↓ agente consume A y detecta intent

Evento C: agente action (clasificación)
  id: "evt_003"
  causation_id: "evt_001"      (causado por A)
  correlation_id: "conv_123"   (misma conversación)

      ↓ otro agente consume C y escala

Evento D: agente action (escalación)
  id: "evt_004"
  causation_id: "evt_003"      (causado por C, no por A)
  correlation_id: "conv_123"   (misma conversación)
```

---

## 8. Idempotencia

### 8.1 Clave de idempotencia

La `idempotencykey` debe ser determinística y derivada del contenido del payload raw:

```
sha256(canonical_json(raw_body))
```

### 8.2 Integración con JetStream

La `idempotencykey` se mapea al header `Nats-Msg-Id` al momento del publish. JetStream deduplica automáticamente mensajes con el mismo `Nats-Msg-Id` dentro de la `duplicate_window` del stream (default: 2 minutos).

Esto significa que si el mismo webhook llega dos veces (retry del provider), solo se persiste una copia en el stream.

---

## 9. Interfaz del módulo de ingress

Cada integración con un provider implementa funciones puras que se componen en un pipeline:

```
verifySignature
  |> validateStructure
  |> checkPayloadSize
  |> storeIfClaimCheck   (condicional)
  |> buildEnvelope
  |> publish
```

Funciones por módulo:

```
// verify.ts — uno por provider
verifySignature(request, secret) -> Result<ok, err>

// validate.ts — uno por provider
validateStructure(rawBody) -> Result<ok, err>

// envelope.ts — uno por provider
buildEnvelope(rawBody, transport, context) -> Result<Envelope, err>

// headers.ts — uno por provider
filterHeaders(headers) -> Record<string, string>
```

Para agentes, el pipeline varía (ver doc 03).

Cada función es stateless. La lógica específica de cada provider está aislada en su propio directorio de módulo.
