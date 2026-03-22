# NATS Ingress Spec v1

**Estado:** Borrador para revisión
**Audiencia:** Infra + Dev
**Fecha:** 2026-03-21
**Origen:** Sesión de diseño — `nats-ingress-design-notes.md`

---

## 1. Objetivo

Introducir NATS JetStream como bus de eventos para `coexistance`, empezando por eventos de ingress desde providers externos (WhatsApp, Instagram, etc.) y agentes AI internos. El bus debe ser multi-tenant, multi-canal, multi-provider, y extensible a transportes no-HTTP e ingress de agentes.

El primer milestone es un shadow publish en paralelo al flujo existente. No se modifica ningún comportamiento actual.

### 1.1 Flujo actual

```
webhook -> parse -> Mongo -> websocket
```

### 1.2 Flujo objetivo (milestone 1)

```
webhook -> parse -> Mongo -> websocket
                         \-> publish NATS (shadow, non-blocking)
```

### 1.3 Fuera de alcance para milestone 1

- Reemplazar Mongo como persistencia primaria
- Reemplazar websocket como mecanismo de notificación a UI
- Publicar eventos derivados/canónicos (Capa 2)
- Consumir eventos del bus para lógica de negocio
- Ingress de agentes AI (ver sección 10 para diseño preparatorio)

---

## 2. Decisiones cerradas

Estas decisiones son finales. No deben reabrirse sin una revisión formal de diseño.

| # | Decisión | Justificación |
|---|----------|---------------|
| D1 | Envelope genérico + raw payload intacto | Preserva fidelidad del provider, desacopla captura de lógica de negocio |
| D2 | JetStream, no Core NATS | Durabilidad, replay, tolerancia a caídas, desacople de consumers |
| D3 | 1 evento por POST raw recibido (no split) | Preserva el boundary real del provider. Splitting es responsabilidad de Capa 2 |
| D4 | Routing por NATS subject, no por campos del body | Evita parsear payload para routing. Habilita wildcards y ACLs nativos |
| D5 | Un stream por tenant con limits explícitos | Aislamiento de storage. Evita noisy neighbor en disco |
| D6 | Raw completo + ACL por tenant para PII | Raw viaja intacto. Protección perimetral por NATS accounts/ACLs, no por redacción |
| D7 | Shadow publish inicial (fire-and-forget) | El bus no es crítico en milestone 1. Falla del publish no bloquea el flujo principal |
| D8 | Allowlist explícito de headers HTTP | Solo headers útiles viajan en el evento. Reduce ruido y tamaño |
| D9 | `traceid` en el envelope | Correlación cross-service con OpenTelemetry |
| D10 | Renombrar campo `subject` a `resource` en el envelope | Evita colisión semántica con el subject de NATS |
| D11 | `causation_id` y `correlation_id` en el envelope | Trazabilidad de cadenas causales y flujos de negocio. Crítico para agentes |
| D12 | Mecanismo anti-loop con `depth` para eventos de agentes | Previene ciclos infinitos entre agentes que producen y consumen del bus |

---

## 3. Diseño de subjects

### 3.1 Formato

```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1
```

> `env` no vive en el subject. Se separa por stream o por NATS account por entorno.
> Esto evita que un wildcard accidental en dev toque datos de prod.

### 3.2 Ejemplos

```
evt.acme.coexistance.messaging.whatsapp.meta.ingress.v1
evt.acme.coexistance.messaging.instagram.meta.ingress.v1
evt.acme.coexistance.messaging.tiktok.bytedance.ingress.v1
evt.acme.coexistance.messaging.telegram.telegram.ingress.v1
evt.acme.coexistance.messaging.email.sendgrid.ingress.v1
evt.acme.coexistance.messaging.whatsapp.internal.agent_outbound.v1
evt.acme.coexistance.messaging.webchat.internal.agent_outbound.v1
```

### 3.3 Wildcard subscriptions

```
evt.acme.coexistance.messaging.>              -- todo messaging para acme
evt.acme.coexistance.messaging.whatsapp.>     -- todo whatsapp para acme
evt.*.coexistance.messaging.>                 -- todo messaging, todos los tenants
evt.acme.coexistance.messaging.*.internal.>   -- todo lo generado por agentes internos para acme
```

### 3.4 Nota sobre channel+provider redundante

Cuando channel y provider son la misma entidad (e.g., Telegram), el valor se repite: `telegram.telegram`. Esto es aceptable y mantiene la estructura del subject predecible para todos los consumers. No omitir el token de provider.

### 3.5 Convención para agentes internos

Cuando el origen del evento es un agente AI interno (no un provider externo), el provider es `internal`. El kind refleja la naturaleza del evento:

| Kind | Descripción |
|------|-------------|
| `ingress` | Evento entrante desde provider externo |
| `agent_outbound` | Mensaje generado por un agente para enviar |
| `agent_action` | Acción decidida por un agente (clasificar, escalar, etc.) |
| `agent_observation` | Observación o análisis generado por un agente |

---

## 4. Contrato del envelope

Inspirado en CloudEvents 1.0, adaptado para el bus interno.

### 4.1 Campos requeridos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `specversion` | string | Siempre `"1.0"` |
| `id` | string | ID único del evento (ULID recomendado) |
| `source` | string | URI del servicio + endpoint que produce el evento |
| `type` | string | Tipo de evento en notación reverse-domain |
| `resource` | string | Identifica el recurso al que aplica el evento |
| `time` | string | Timestamp ISO 8601 de creación del evento |
| `traceid` | string | Trace ID de OpenTelemetry para correlación cross-service |
| `causation_id` | string \| null | ID del evento que causó este evento. `null` si es un evento raíz |
| `correlation_id` | string | ID del flujo de negocio al que pertenece (e.g., conversación, ticket) |
| `tenant` | string | Identificador del tenant |
| `producer` | string | Servicio que publicó el evento |
| `domain` | string | Dominio de negocio (e.g., `messaging`) |
| `channel` | string | Canal de comunicación (e.g., `whatsapp`) |
| `provider` | string | Proveedor de infraestructura (e.g., `meta`, `internal`) |
| `accountid` | string | ID de cuenta del provider dentro del tenant |
| `idempotencykey` | string | Clave determinística para deduplicación |
| `transport` | object | Metadata del transporte (ver sección 4.3) |
| `data` | object | Contiene `received_at` y `payload` (body raw del provider) |

### 4.2 Ejemplo de evento (ingress externo)

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
  "idempotencykey": "sha256:...",
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
    "payload": { "...": "raw meta webhook body" }
  }
}
```

### 4.3 Abstracción de transporte

El campo `transport` soporta múltiples mecanismos de ingress. Los únicos campos requeridos son `method` y `protocol`. El resto es específico de cada método.

**Webhook (HTTP POST desde el provider):**
```json
{
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "headers": {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=..."
    }
  }
}
```

**Polling (el servicio consulta la API del provider):**
```json
{
  "transport": {
    "method": "poll",
    "protocol": "https",
    "poll_source": "https://api.provider.com/v1/messages",
    "poll_cursor": "cursor_abc123"
  }
}
```

**Websocket (conexión persistente desde el provider):**
```json
{
  "transport": {
    "method": "stream",
    "protocol": "wss",
    "connection_id": "conn_xyz"
  }
}
```

**AMQP / Cola externa (bridge desde otro broker):**
```json
{
  "transport": {
    "method": "queue_bridge",
    "protocol": "amqp",
    "source_queue": "provider.events",
    "delivery_tag": "dt_12345"
  }
}
```

**Agente AI (evento generado por un agente interno):**
```json
{
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "cs-agent-v2",
    "agent_model": "claude-sonnet-4-6",
    "agent_session": "session_abc123",
    "agent_capabilities": ["reply", "classify", "escalate"],
    "confidence": 0.92,
    "tool_chain": ["read_conversation", "classify_intent", "generate_reply"],
    "depth": 1
  }
}
```

Cada método de transporte define sus propios campos relevantes. Ver sección 10 para detalles del transporte de agentes.

### 4.4 Allowlist de headers (transporte webhook)

Solo los siguientes headers se capturan para ingress por webhook. Todos los demás se descartan antes de publicar.

```
content-type
x-hub-signature-256
x-hub-signature
x-request-id
user-agent
```

Esta lista debe ser configurable por provider. Cada módulo de ingress declara su propio allowlist.

### 4.5 Clave de idempotencia

La `idempotencykey` debe ser determinística y derivada del contenido del payload raw. Approach recomendado: `sha256(canonical_json(raw_body))`.

Esta clave se mapea directamente al header `Nats-Msg-Id` en el momento del publish, habilitando la deduplicación nativa de JetStream sin lógica custom.

### 4.6 Cadena causal y correlación

Estos dos campos son esenciales para trazabilidad, especialmente cuando hay agentes en el flujo.

**`causation_id`** — apunta al `id` del evento que directamente causó este evento. Si un agente consume un evento de ingress y genera una respuesta, el `causation_id` del evento de respuesta es el `id` del evento de ingress original. Si el evento es raíz (e.g., un webhook que llega sin trigger previo), el valor es `null`.

**`correlation_id`** — identifica el flujo de negocio completo al que pertenece el evento. Todos los eventos de una misma conversación, ticket, o transacción comparten el mismo `correlation_id`. Se propaga sin modificarse a lo largo de toda la cadena.

Ejemplo de cadena:

```
Evento A: ingress de WhatsApp
  id: "evt_001"
  causation_id: null           (raíz)
  correlation_id: "conv_123"

Evento B: agente decide responder (consume A)
  id: "evt_002"
  causation_id: "evt_001"      (causado por A)
  correlation_id: "conv_123"   (misma conversación)

Evento C: agente detecta intent (consume A)
  id: "evt_003"
  causation_id: "evt_001"      (causado por A)
  correlation_id: "conv_123"   (misma conversación)
```

---

## 5. Configuración de JetStream

### 5.1 Aislamiento por entorno

Cada entorno (dev, staging, prod) corre en un NATS account o cluster separado. No hay tráfico cross-env.

### 5.2 Streams por tenant

Cada tenant tiene un stream dedicado con limits explícitos.

```
Nombre del stream:  INGRESS-{tenant}
Subjects:           evt.{tenant}.>
Storage:            file
Retention:          limits
Discard policy:     old (descarta el más viejo cuando se llena)
```

### 5.3 Limits por defecto por stream

| Limit | Default | Notas |
|-------|---------|-------|
| `max_age` | 7 días | Configurable por tenant |
| `max_bytes` | 1 GB | Configurable por tier (free/enterprise) |
| `max_msg_size` | 4 MB | El `max_payload` del cluster debe coincidir |
| `max_msgs` | -1 (ilimitado) | Controlado por max_bytes y max_age |
| `duplicate_window` | 2 minutos | Para dedup por Nats-Msg-Id |
| `num_replicas` | 3 | Para prod. 1 para dev/staging |

### 5.4 Configuración del cluster

Configurar `max_payload` en al menos 4 MB a nivel del servidor NATS. El default de 1 MB es demasiado bajo para providers futuros que hagan batching de payloads grandes.

### 5.5 Ciclo de vida del stream

Cuando se provisiona un tenant, su stream se crea automáticamente via API con limits por defecto. Cuando se desactiva un tenant, el stream se pausa (no se borra) durante el período de retención.

---

## 6. Seguridad

### 6.1 NATS accounts y ACLs

Cada tenant opera dentro de un NATS account (o scope de ACL) que restringe:

- **Publish:** solo el servicio de ingress puede publicar en `evt.{tenant}.>`
- **Subscribe:** solo servicios autorizados para ese tenant pueden subscribirse a `evt.{tenant}.>`
- **Aislamiento cross-tenant:** ningún account puede subscribirse a `evt.{otro_tenant}.>`

### 6.2 Verificación de firma de webhooks

La verificación de firma DEBE ocurrir ANTES de publicar al bus. Un payload no verificado nunca entra al bus.

Cada provider tiene su propio mecanismo de verificación:

| Provider | Mecanismo | Header |
|----------|-----------|--------|
| Meta (WhatsApp, Instagram) | HMAC-SHA256 | `x-hub-signature-256` |
| TikTok | HMAC-SHA256 | `x-tiktok-signature` |
| X/Twitter | HMAC-SHA1 / CRC token | `x-twitter-webhooks-signature` |
| Telegram | IP allowlist + secret token | `x-telegram-bot-api-secret-token` |

Implementación: cada módulo de ingress del provider expone una función `verifySignature(request, secret) -> Result<ok, err>`. Si la verificación falla, el request se loguea y se rechaza con 401. No se publica nada.

### 6.3 Validación de payload

Antes de publicar, el módulo de ingress debe validar que el body raw tiene la estructura esperada para el provider declarado. No es validación full de schema — es un chequeo estructural liviano para prevenir payloads malformados o maliciosos.

Cada módulo de provider declara una función `validateStructure(rawBody) -> Result<ok, err>` que verifica:

- Las keys top-level esperadas están presentes
- El body es JSON válido (o el formato esperado del provider)
- El tamaño del body está dentro de `max_msg_size`

Si la validación falla, el evento se loguea a un topic de dead-letter (`dlq.{tenant}.ingress.invalid.v1`) y no se publica al stream principal.

### 6.4 Política de PII

Para milestone 1, el raw payload viaja completo (incluyendo teléfonos, nombres, contenido de mensajes). La protección es perimetral:

- ACLs previenen que servicios no autorizados lean el stream
- No hay acceso cross-tenant posible
- Los streams están encriptados at rest (encriptación de file storage de JetStream)
- TLS en tránsito entre todos los nodos y clientes de NATS

Si cambian los requerimientos de compliance (GDPR, LGPD), la arquitectura soporta agregar un paso de redacción entre el ingress y el publish sin cambiar el contrato del envelope.

### 6.5 Rate limiting

Cada combinación tenant+channel debe tener un límite de tasa de publish para prevenir que una integración sature el cluster.

| Tier | Límite (msgs/seg) | Burst |
|------|--------------------|-------|
| Default | 100 | 500 |
| Enterprise | 1000 | 5000 |
| Agente interno | 200 | 1000 |
| Agente de tercero | 50 | 200 |
| Agente de plataforma | 100 | 500 |

Rate limiting se aplica a nivel del servicio de ingress (antes del publish), no a nivel de NATS. Eventos rechazados por rate limit se loguean y retornan 429 al provider (si es webhook) o se dropean con métricas (si es poll/stream/agent).

Los agentes de terceros tienen limits más bajos por defecto porque corren fuera de nuestra infra y representan mayor riesgo de abuso. Se pueden elevar por contrato.

### 6.6 Seguridad para agentes AI

Los agentes AI que publican al bus se clasifican en tres categorías con perfiles de confianza distintos (ver sección 10.1). Cada categoría tiene sus propias reglas de seguridad.

#### 6.6.1 Agentes internos (trust: alto)

Corren en nuestra infra, los controlamos end-to-end.

- **Autenticación:** token de servicio scoped al tenant, emitido por el sistema de identidad interno
- **Subjects permitidos:** configurables por agente. Un agente de atención solo puede publicar `agent_outbound`, no `agent_action`
- **Validación de output:** chequeo estructural estándar. El output es datos no confiables hasta que se valida
- **Audit trail:** `tool_chain` y `confidence` se loguean obligatoriamente

#### 6.6.2 Agentes de terceros (trust: bajo)

Corren fuera de nuestra infra. Son como apps de terceros en un marketplace.

- **Autenticación:** API key + secret emitidos por tenant. Rotación obligatoria cada 90 días
- **Subjects permitidos:** estrictamente limitados. Solo pueden publicar a subjects que el tenant haya autorizado explícitamente
- **Validación de output:** chequeo estructural + validación de tamaño más estricta (max 1 MB vs 4 MB para internos)
- **Sandbox de datos:** un agente de tercero NUNCA puede leer el stream completo del tenant. Solo recibe los eventos que el tenant le haya subscripto explícitamente via consumer dedicado
- **Rate limiting:** el más restrictivo (50 msgs/seg default). No se puede elevar sin aprobación explícita
- **Audit trail:** todo logueo de agentes de terceros incluye adicionalmente `origin_ip` y `api_key_id` para trazabilidad
- **Revocación:** el tenant puede revocar el acceso de un agente de tercero en cualquier momento. La revocación es efectiva en menos de 1 minuto (invalidación de token)

#### 6.6.3 Agentes de plataforma (trust: medio)

Servicios AI de providers como OpenAI, Anthropic, Google, u otros SaaS. No los controlamos pero son proveedores conocidos.

- **Autenticación:** OAuth2 client credentials o API key emitida por nosotros, scoped al tenant + servicio
- **Subjects permitidos:** definidos por la integración. Cada integración con un proveedor de plataforma tiene un scope fijo de subjects
- **Validación de output:** chequeo estructural + validación de schema del proveedor de plataforma (cada proveedor tiene formatos de respuesta conocidos)
- **Aislamiento:** el agente de plataforma solo puede interactuar con los datos del tenant que lo configuró. No hay visibilidad cross-tenant
- **Rate limiting:** medio (100 msgs/seg default). Ajustable por integración
- **Audit trail:** incluye `platform_provider`, `platform_model`, y `platform_request_id` para correlación con los logs del proveedor

#### 6.6.4 Regla general

Independientemente de la categoría, todo evento con `transport.method: "agent"` es tratado como datos no confiables hasta que pasa por el pipeline de validación. Ningún agente tiene privilegios especiales sobre el bus.

**Límite de profundidad (anti-loop):** aplica a las tres categorías. Ver sección 10.5 para el mecanismo completo.

---

## 7. Semánticas de publish (Milestone 1)

### 7.1 Shadow publish

En milestone 1, el publish a NATS es non-blocking y fire-and-forget respecto al flujo principal:

```
// pseudocódigo
const result = await saveToMongo(parsed)
await notifyWebsocket(parsed)

// shadow publish - no bloquea la respuesta al provider
publishToNats(envelope).catch(logPublishError)
```

### 7.2 Manejo de fallos

Si el publish falla:

- Loguear el error con contexto completo (tenant, channel, event id, error)
- Incrementar métrica `nats.publish.failure` con tags (tenant, channel, provider)
- NO reintentar en milestone 1 — el flujo principal (Mongo + websocket) no se ve afectado
- NO bloquear la respuesta del webhook al provider

### 7.3 Milestone futuro: publish como camino primario

Cuando el bus se convierta en el camino primario, el publish debe ser confirmado por JetStream antes de responder al provider. En ese punto:

- El publish usa `jetstream.publish()` con ack wait
- Si falla, reintentar con backoff (máximo 3 intentos)
- Si todos los reintentos fallan, escribir a un archivo local de dead-letter y alertar
- La respuesta del webhook se retiene hasta que el publish se confirma o falla

Esto está fuera de alcance para milestone 1.

---

## 8. Interfaz del módulo de ingress

Cada integración con un provider debe implementar la siguiente interfaz (como funciones puras, no clases):

```
// verify.ts - uno por provider
verifySignature(request, secret) -> Result<ok, err>

// validate.ts - uno por provider
validateStructure(rawBody) -> Result<ok, err>

// envelope.ts - uno por provider
buildEnvelope(rawBody, transport, context) -> Result<Envelope, err>

// headers.ts - uno por provider
filterHeaders(headers) -> Record<string, string>
// lee de una config de allowlist específica del provider
```

El pipeline de ingress compone estas funciones:

```
verifySignature
  |> validateStructure
  |> buildEnvelope
  |> publish
```

Para agentes internos, el pipeline es ligeramente distinto (ver sección 10.3).

Cada función es stateless. La lógica específica de cada provider está aislada en su propio directorio de módulo.

---

## 9. Observabilidad

### 9.1 Métricas (mínimas)

| Métrica | Tags | Tipo |
|---------|------|------|
| `ingress.received` | tenant, channel, provider | counter |
| `ingress.verified` | tenant, channel, provider | counter |
| `ingress.verification_failed` | tenant, channel, provider | counter |
| `ingress.validation_failed` | tenant, channel, provider | counter |
| `ingress.published` | tenant, channel, provider | counter |
| `ingress.publish_failed` | tenant, channel, provider | counter |
| `ingress.publish_latency_ms` | tenant, channel, provider | histogram |
| `ingress.payload_bytes` | tenant, channel, provider | histogram |
| `ingress.rate_limited` | tenant, channel, provider | counter |
| `ingress.agent.depth_exceeded` | tenant, agent_id | counter |
| `ingress.agent.events` | tenant, agent_id, kind | counter |
| `ingress.agent.confidence` | tenant, agent_id | histogram |

### 9.2 Logging

Cada paso en el pipeline de ingress loguea como mínimo:

- `event_id` (el id del envelope)
- `trace_id` (OpenTelemetry)
- `causation_id`
- `correlation_id`
- `tenant`
- `channel`
- `provider`

Verificaciones y validaciones fallidas se loguean a nivel `warn` con la razón. Fallos de publish se loguean a nivel `error` con el envelope completo (sin `data.payload` para evitar loguear PII).

Para eventos de agentes, se loguea adicionalmente: `agent_id`, `depth`, `confidence`, y `tool_chain`.

### 9.3 Alertas (recomendadas)

| Condición | Severidad | Acción |
|-----------|-----------|--------|
| Tasa de `publish_failed` > 5% por 5 min | warning | Pagar on-call |
| Tasa de `verification_failed` > 20% por 5 min | critical | Posible ataque o rotación de key del provider |
| Storage del stream > 80% de `max_bytes` | warning | Revisar retención o aumentar limits |
| `rate_limited` count > 0 sostenido | info | Revisar tier del tenant |
| `agent.depth_exceeded` count > 0 | warning | Posible loop entre agentes |
| `agent.confidence` p50 < 0.5 sostenido | info | Revisar calidad del agente |

---

## 10. Ingress de agentes AI

### 10.1 Categorías de agentes

No todos los agentes son iguales. El bus debe soportar tres categorías con perfiles de confianza, acceso, y control distintos.

#### Agentes internos (trust: alto)

Son agentes que nosotros desarrollamos y operamos. Corren en nuestra infra, sobre nuestros modelos o modelos que nosotros invocamos. Los controlamos end-to-end.

Ejemplos: bot de atención al cliente que responde en WhatsApp, clasificador de intents, agente de escalación automática, agente que monitorea conversaciones y genera alertas.

El provider en el subject es `internal`:
```
evt.acme.coexistance.messaging.whatsapp.internal.agent_outbound.v1
```

#### Agentes de terceros (trust: bajo)

Son agentes desarrollados por un partner, cliente, o integrador externo. Corren fuera de nuestra infra, no controlamos su código, y no confiamos en su comportamiento. Es el equivalente AI de una "app de tercero en un marketplace" — como un bot de Slack creado por alguien externo.

Ejemplos: un partner que construye un agente de ventas y quiere que interactúe con las conversaciones de su tenant, un integrador que conecta su propio modelo de NLP para clasificar mensajes.

El provider en el subject es `thirdparty`:
```
evt.acme.coexistance.messaging.whatsapp.thirdparty.agent_outbound.v1
```

Restricciones clave:

- No acceden al stream completo del tenant. Solo reciben eventos que el tenant les haya subscripto explícitamente via consumer dedicado
- Solo pueden publicar a subjects que el tenant haya autorizado
- Payloads más pequeños (max 1 MB vs 4 MB)
- Rate limits más agresivos (50 msgs/seg default)
- API key con rotación obligatoria cada 90 días
- Revocación inmediata disponible para el tenant

#### Agentes de plataforma (trust: medio)

Son servicios AI de providers conocidos (OpenAI, Anthropic, Google, etc.) que se integran como servicios commodity. No los operamos pero son proveedores con SLAs y formatos de respuesta documentados.

Dos modalidades de ingress:

**Push (el proveedor envía):** el proveedor de plataforma hace un callback o webhook a nuestro sistema con el resultado. Es análogo a un webhook de Meta pero el origen es un servicio AI. Ejemplo: un agente de OpenAI que termina de procesar una conversación y envía el resultado via webhook.

**Pull (nosotros consultamos):** nuestro sistema invoca la API del proveedor, obtiene la respuesta, y la publica al bus. El transporte es `poll` pero el origen es un modelo de plataforma. Ejemplo: llamamos a la API de Anthropic para clasificar un mensaje y publicamos el resultado.

El provider en el subject es el nombre del proveedor:
```
evt.acme.coexistance.messaging.whatsapp.openai.agent_outbound.v1
evt.acme.coexistance.messaging.whatsapp.anthropic.agent_action.v1
```

### 10.2 Relación con MCP y A2A

**MCP (Model Context Protocol)** es request-response: un agente llama a un tool y espera una respuesta. No es un mecanismo de eventos. Sin embargo, un MCP server puede exponer el bus como tool — el agente llama `publish_event` y el server publica al bus internamente. Esto es relevante para las tres categorías de agentes:

- Agente interno: usa MCP tools directamente contra nuestro server
- Agente de tercero: usa MCP tools expuestos via API gateway con auth scoped
- Agente de plataforma: si el proveedor soporta MCP (como Anthropic), puede usar nuestros tools directamente

**A2A (Agent-to-Agent Protocol)** es el protocolo de Google para comunicación entre agentes. Define descubrimiento (Agent Cards), delegación de tareas, y coordinación. Es relevante cuando múltiples agentes de distintas categorías necesitan coordinarse. Ejemplo: un agente interno delega una clasificación a un agente de plataforma, que retorna el resultado, y el agente interno toma una acción.

**Recomendación por milestone:**

| Milestone | Acción |
|-----------|--------|
| M1 | Solo providers externos (WhatsApp, etc.). Sin agentes |
| M2 | Agentes internos via MCP server. El bus expone `publish_event` como tool |
| M3 | Agentes de plataforma via integraciones directas (API calls + publish) |
| M4 | Agentes de terceros via API gateway + marketplace de integraciones |
| M5 | Evaluar A2A como protocolo de coordinación entre agentes de distintas categorías |

### 10.3 Transport por categoría de agente

Cada categoría de agente tiene su propio formato de `transport`. Los campos comunes son `method`, `protocol`, `agent_id`, y `depth`. Los campos adicionales varían.

**Agente interno:**
```json
{
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "cs-agent-v2",
    "agent_model": "claude-sonnet-4-6",
    "agent_session": "session_abc123",
    "agent_capabilities": ["reply", "classify", "escalate"],
    "confidence": 0.92,
    "tool_chain": ["read_conversation", "classify_intent", "generate_reply"],
    "depth": 1
  }
}
```

**Agente de tercero:**
```json
{
  "transport": {
    "method": "agent",
    "protocol": "thirdparty",
    "agent_id": "partner-acme-sales-bot",
    "agent_vendor": "partner-xyz",
    "api_key_id": "key_abc123",
    "origin_ip": "203.0.113.42",
    "agent_capabilities": ["reply"],
    "depth": 1
  }
}
```

Notar que un agente de tercero no declara `agent_model` ni `confidence` — no confiamos en que reporte esos valores correctamente. Si los envía, se guardan pero no se usan para decisiones internas.

**Agente de plataforma (push):**
```json
{
  "transport": {
    "method": "agent",
    "protocol": "platform",
    "agent_id": "openai-assistant-xyz",
    "platform_provider": "openai",
    "platform_model": "gpt-4o",
    "platform_request_id": "req_abc123",
    "confidence": 0.88,
    "depth": 1
  }
}
```

**Agente de plataforma (pull — nosotros consultamos):**
```json
{
  "transport": {
    "method": "poll",
    "protocol": "platform",
    "agent_id": "anthropic-classifier",
    "platform_provider": "anthropic",
    "platform_model": "claude-sonnet-4-6",
    "platform_request_id": "msg_abc123",
    "poll_source": "https://api.anthropic.com/v1/messages",
    "confidence": 0.95,
    "depth": 1
  }
}
```

### 10.4 Pipeline de ingress por categoría

El pipeline base es el mismo para las tres categorías, pero los pasos de autenticación y validación varían.

**Agente interno:**
```
authenticateServiceToken
  |> validateAgentOutput
  |> enforceDepthLimit
  |> buildEnvelope
  |> publish
```

**Agente de tercero:**
```
authenticateApiKey
  |> validateTenantAuthorization
  |> validateAgentOutput (strict: max 1 MB)
  |> enforceDepthLimit
  |> enforceRateLimit
  |> buildEnvelope
  |> publish
```

El paso extra `validateTenantAuthorization` verifica que el tenant haya autorizado a este agente de tercero para publicar al subject solicitado. Sin esa autorización, el evento se rechaza.

**Agente de plataforma (push):**
```
verifyPlatformSignature
  |> validatePlatformPayload
  |> enforceDepthLimit
  |> buildEnvelope
  |> publish
```

Similar a un webhook externo: el proveedor de plataforma firma el callback, nosotros verificamos.

**Agente de plataforma (pull):**
```
callPlatformApi
  |> validatePlatformResponse
  |> enforceDepthLimit
  |> buildEnvelope
  |> publish
```

Acá no hay autenticación entrante porque somos nosotros quienes iniciamos el request. La validación es sobre la respuesta del proveedor.

Funciones comunes (reutilizables entre categorías):

```
// depth.ts
enforceDepthLimit(causationEvent, maxDepth) -> Result<ok, err>

// envelope.ts
buildAgentEnvelope(output, agentIdentity, context) -> Result<Envelope, err>
```

Funciones específicas por categoría:

```
// internal/auth.ts
authenticateServiceToken(token, tenant) -> Result<AgentIdentity, err>

// thirdparty/auth.ts
authenticateApiKey(apiKey, tenant) -> Result<AgentIdentity, err>

// thirdparty/authorize.ts
validateTenantAuthorization(agentId, tenant, subject) -> Result<ok, err>

// platform/verify.ts
verifyPlatformSignature(request, platformProvider) -> Result<ok, err>
```

### 10.5 Mecanismo anti-loop

Cuando un agente consume un evento del bus y publica otro como resultado, existe el riesgo de loops infinitos. Esto aplica a las tres categorías de agentes.

El mecanismo de prevención usa el campo `depth` dentro de `transport`:

- Todo evento raíz (webhook externo, acción manual) tiene `depth: 0`
- Cuando un agente consume un evento con `depth: N` y genera un nuevo evento, el nuevo tiene `depth: N + 1`
- Si `depth >= MAX_DEPTH`, el evento se rechaza y se envía a DLQ con razón `depth_exceeded`
- La métrica `ingress.agent.depth_exceeded` se incrementa

Defaults de `MAX_DEPTH` por categoría:

| Categoría | MAX_DEPTH default | Justificación |
|-----------|-------------------|---------------|
| Interno | 5 | Cadenas razonables: ingress -> clasificar -> decidir -> responder -> confirmar |
| Tercero | 2 | Superficie mínima. Un tercero no debería encadenar más de 2 pasos |
| Plataforma | 3 | Permite request -> respuesta -> acción derivada |

`MAX_DEPTH` es configurable por tenant y por agente.

### 10.6 Ejemplos de eventos

**Agente interno respondiendo a un ingress de WhatsApp:**
```json
{
  "specversion": "1.0",
  "id": "01JQYYYY",
  "source": "/services/coexistance/agents/cs-agent-v2",
  "type": "io.yoizen.messaging.agent.outbound.v1",
  "resource": "tenant/acme/account/69bea8cd/channel/whatsapp/agent/cs-agent-v2",
  "time": "2026-03-21T15:40:12.100Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": "01JQXXXX",
  "correlation_id": "conv_acme_wa_5551234_20260321",
  "tenant": "acme",
  "producer": "coexistance",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "internal",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:...",
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "cs-agent-v2",
    "agent_model": "claude-sonnet-4-6",
    "agent_session": "session_abc123",
    "agent_capabilities": ["reply", "classify", "escalate"],
    "confidence": 0.92,
    "tool_chain": ["read_conversation", "classify_intent", "generate_reply"],
    "depth": 1
  },
  "data": {
    "received_at": "2026-03-21T15:40:12.100Z",
    "payload": {
      "action": "reply",
      "message": {
        "text": "Hola, en qué puedo ayudarte hoy?",
        "language": "es"
      },
      "intent_detected": "greeting",
      "suggested_next": ["ask_topic", "offer_menu"]
    }
  }
}
```

**Agente de tercero publicando una clasificación:**
```json
{
  "specversion": "1.0",
  "id": "01JQZZZZ",
  "source": "/services/coexistance/gateway/thirdparty/partner-xyz",
  "type": "io.yoizen.messaging.agent.action.v1",
  "resource": "tenant/acme/account/69bea8cd/channel/whatsapp/agent/partner-acme-sales-bot",
  "time": "2026-03-21T15:41:00.000Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": "01JQXXXX",
  "correlation_id": "conv_acme_wa_5551234_20260321",
  "tenant": "acme",
  "producer": "coexistance",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "thirdparty",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:...",
  "transport": {
    "method": "agent",
    "protocol": "thirdparty",
    "agent_id": "partner-acme-sales-bot",
    "agent_vendor": "partner-xyz",
    "api_key_id": "key_abc123",
    "origin_ip": "203.0.113.42",
    "agent_capabilities": ["classify"],
    "depth": 1
  },
  "data": {
    "received_at": "2026-03-21T15:41:00.000Z",
    "payload": {
      "action": "classify",
      "classification": {
        "intent": "purchase_inquiry",
        "product_category": "electronics",
        "urgency": "medium"
      }
    }
  }
}
```

### 10.7 Matriz comparativa

| Aspecto | Provider externo | Agente interno | Agente tercero | Agente plataforma |
|---------|------------------|----------------|----------------|-------------------|
| Trust | Alto (firma verificada) | Alto (nuestra infra) | Bajo (código ajeno) | Medio (SaaS conocido) |
| Autenticación | HMAC webhook | Token de servicio | API key + tenant auth | OAuth2 / firma de callback |
| Corre en nuestra infra | No (pero verificamos firma) | Sí | No | No |
| Acceso al stream | N/A (solo publica) | Lectura completa del tenant | Solo consumer dedicado | Solo lo que la integración defina |
| Max payload | 4 MB | 4 MB | 1 MB | 4 MB |
| Rate limit default | 100 msgs/seg | 200 msgs/seg | 50 msgs/seg | 100 msgs/seg |
| MAX_DEPTH | 0 (raíz) | 5 | 2 | 3 |
| Bidireccional | No | Sí | Sí (limitado) | Sí |
| Riesgo de loop | Ninguno | Alto | Medio | Medio |
| Metadata extra | Headers HTTP | model, confidence, tool_chain | vendor, api_key_id, origin_ip | platform_provider, platform_model |
| Revocación | Rotar webhook secret | Rotar token de servicio | Inmediata por tenant | Rotar credenciales OAuth2 |

---

## 11. Puntos abiertos

Estos items necesitan resolución antes o durante la implementación.

| # | Tema | Owner | Estado |
|---|------|-------|--------|
| O1 | Confirmar `max_payload` del cluster (recomendación: 4 MB) | Infra | Pendiente |
| O2 | Definir estructura de NATS accounts (1 por tenant vs 1 por env con ACLs) | Infra | Pendiente |
| O3 | Definir estrategia de dead-letter para validaciones fallidas | Dev | Pendiente |
| O4 | Definir allowlist de headers por provider (empezar con Meta) | Dev | Pendiente |
| O5 | Definir configuración de encriptación at rest de JetStream | Infra | Pendiente |
| O6 | Definir automatización de provisioning de tenants (creación de stream) | Infra + Dev | Pendiente |
| O7 | Definir dashboard de monitoreo para streams (storage, rate, fallos) | Infra | Pendiente |
| O8 | Evaluar si `provider` debería ser opcional para canales single-provider | Dev | Pendiente |
| O9 | Definir contrato de transporte para providers basados en polling (primer candidato TBD) | Dev | Pendiente |
| O10 | Definir estrategia de redacción de PII si cambian requerimientos de compliance | Dev + Legal | Pendiente |
| O11 | Definir formato de Agent Cards para descubrimiento de capacidades de agentes | Dev | Pendiente |
| O12 | Evaluar MCP server como interfaz de publish para agentes internos (milestone 2) | Dev | Pendiente |
| O13 | Definir política de retención diferenciada para eventos de agentes vs externos | Infra | Pendiente |
| O14 | Definir `MAX_DEPTH` por defecto y política de override por tenant y categoría | Dev | Pendiente |
| O15 | Definir esquema de `correlation_id` (formato, quién lo genera, propagación) | Dev | Pendiente |
| O16 | Diseñar API gateway para agentes de terceros (auth, rate limit, subject scoping) | Dev + Infra | Pendiente |
| O17 | Definir proceso de onboarding de agentes de terceros (emisión de API key, autorización de subjects por tenant) | Dev + Producto | Pendiente |
| O18 | Definir integraciones con proveedores de plataforma AI (primer candidato: Anthropic o OpenAI) | Dev | Pendiente |
| O19 | Definir política de rotación de API keys para agentes de terceros (default: 90 días) | Infra + Seguridad | Pendiente |
| O20 | Evaluar mecanismo de revocación inmediata de agentes de terceros (invalidación de token < 1 min) | Infra | Pendiente |
| O21 | Definir MCP tools expuestos a agentes de terceros via API gateway (milestone 4) | Dev | Pendiente |
| O22 | Evaluar A2A como protocolo de coordinación multi-agente (milestone 5) | Dev | Pendiente |

---

## 12. Glosario

| Término | Definición |
|---------|------------|
| **Envelope** | Wrapper estable de metadata alrededor de un raw payload del provider |
| **Ingress** | El acto de recibir un evento externo o interno hacia el sistema |
| **Shadow publish** | Publicar al bus sin afectar el flujo principal |
| **Raw payload** | El body sin modificar recibido del provider externo o generado por un agente |
| **Transport** | El mecanismo por el cual llegó el evento (webhook, poll, stream, queue bridge, agent) |
| **Capa 1** | Eventos de ingress raw en el bus (este spec) |
| **Capa 2** | Eventos derivados/canónicos producidos al consumir Capa 1 (futuro) |
| **DLQ** | Cola de dead-letter para eventos que fallan validación o publish |
| **MCP** | Model Context Protocol — protocolo request-response para conectar agentes AI con tools |
| **A2A** | Agent-to-Agent Protocol — protocolo de Google para comunicación entre agentes AI |
| **Agent Card** | Descriptor publicado por un agente que declara sus capacidades e interfaces |
| **Depth** | Contador de profundidad causal. Previene loops infinitos entre agentes |
| **Causation ID** | ID del evento que directamente originó este evento |
| **Correlation ID** | ID del flujo de negocio completo al que pertenece un evento |
| **Agente interno** | Agente AI desarrollado y operado por nosotros, corriendo en nuestra infra (trust alto) |
| **Agente de tercero** | Agente AI desarrollado por un partner o integrador externo (trust bajo) |
| **Agente de plataforma** | Servicio AI de un proveedor SaaS conocido como OpenAI, Anthropic, Google (trust medio) |
| **API Gateway** | Punto de entrada para agentes de terceros. Aplica auth, rate limit, y subject scoping |
