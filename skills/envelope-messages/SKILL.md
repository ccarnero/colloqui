---
name: envelope-messages
description: >
  Manejo de envelopes de mensajes siguiendo el diseño CloudEvents adaptado para NATS.
  Trigger: Cuando se trabaja con mensajería, eventos NATS, envelopes, subjects, o transporte de eventos.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "envelope"
    - "messaging"
    - "events"
    - "nats"
---

## When to Use

- Crear o consumir mensajes del bus de eventos
- Diseñar subjects NATS para routing
- Implementar envelopes con metadata CloudEvents
- Manejar trazabilidad (trace_id, causation_id, correlation_id)
- Implementar idempotencia en mensajes
- Trabajar con payloads inline vs claim check
- Diseñar pipelines de ingress para providers

---

## Critical Patterns

### 1. Envelope Structure (CloudEvents-inspired)

Todo mensaje DEBE seguir esta estructura:

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
  "transport": { "method": "webhook", "protocol": "https", ... },
  "data": { "received_at": "...", "payload": {...} }
}
```

**Campos obligatorios:** `specversion`, `id`, `source`, `type`, `resource`, `time`, `traceid`, `tenant`, `producer`, `domain`, `channel`, `provider`, `accountid`, `idempotencykey`, `transport`, `data`.

### 2. Subject Design (NATS)

Formato:
```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1
```

| Token | Descripción | Ejemplos |
|-------|-------------|----------|
| `evt` | Prefijo fijo | siempre `evt` |
| `tenant` | Tenant ID | `acme`, `globex` |
| `producer` | Servicio publicador | `coexistance` |
| `domain` | Dominio de negocio | `messaging` |
| `channel` | Canal | `whatsapp`, `instagram`, `email` |
| `provider` | Proveedor infra | `meta`, `bytedance`, `internal`, `openai` |
| `kind` | Tipo evento | `ingress`, `agent_outbound`, `agent_action` |
| `v1` | Versión | `v1`, `v2` |

**Wildcards:**
- `*` — match un token exacto
- `>` — match uno o más tokens (solo al final)

```
evt.acme.coexistance.messaging.>              -- todo messaging
evt.acme.coexistance.messaging.whatsapp.>     -- todo whatsapp
evt.*.coexistance.messaging.>                 -- todo messaging, todos tenants
```

### 3. Kinds de Evento

| Kind | Descripción | Quién publica |
|------|-------------|---------------|
| `ingress` | Evento entrante desde provider externo | Ingress service |
| `agent_outbound` | Mensaje generado por agente para enviar | Agente (cualquier categoría) |
| `agent_action` | Acción decidida por agente | Agente (cualquier categoría) |
| `agent_observation` | Observación/análisis de agente | Agente (cualquier categoría) |

### 4. Cadena Causal

- **`causation_id`**: ID del evento que causó este. `null` si es raíz.
- **`correlation_id`**: ID del flujo de negocio completo. Se propaga sin modificar.

**Ejemplo cadena:**
```
Evento A (ingress): causation_id=null, correlation_id="conv_123"
  ↓
Evento B (outbound): causation_id="evt_A", correlation_id="conv_123"
  ↓
Evento C (action): causation_id="evt_A", correlation_id="conv_123"
```

### 5. Transport Abstraction

Campo `transport` describe cómo llegó el evento:

| Método | Protocolo | Descripción |
|--------|-----------|-------------|
| `webhook` | `https` | HTTP POST desde provider |
| `poll` | `https` | Servicio consulta API del provider |
| `stream` | `wss` | Conexión websocket persistente |
| `queue_bridge` | `amqp` | Bridge desde otro broker |
| `agent` | `internal`/`thirdparty`/`platform` | Agente AI |

**Headers allowlist (webhook):**
```
content-type, x-hub-signature-256, x-hub-signature, x-request-id, user-agent
```

### 6. Data Payload

Campo `data` contiene:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `received_at` | string | Timestamp ISO 8601 |
| `payload_inline` | boolean | `true` si payload en mensaje |
| `payload_ref` | string\|null | URI al Object Store si claim check |
| `payload_bytes` | number | Tamaño en bytes |
| `payload_checksum` | string | SHA256 para verificación |
| `payload` | object\|null | Raw payload (null si claim check) |

**Modos:**
- **Inline** (común): payload va en el mensaje
- **Claim check** (payload grande): payload en Object Store, referencia en mensaje

### 7. Idempotencia

- `idempotencykey` = `sha256(canonical_json(raw_body))`
- Se mapea a header `Nats-Msg-Id` al publicar
- JetStream deduplica automáticamente en `duplicate_window` (default: 2 min)

### 8. Pipeline de Ingress

Funciones puras que se componen:

```
verifySignature
  |> validateStructure
  |> checkPayloadSize
  |> storeIfClaimCheck   (condicional)
  |> buildEnvelope
  |> publish
```

**Una función por archivo:**
- `verify.ts` — `verifySignature(request, secret) -> Result<ok, err>`
- `validate.ts` — `validateStructure(rawBody) -> Result<ok, err>`
- `envelope.ts` — `buildEnvelope(rawBody, transport, context) -> Result<Envelope, err>`
- `headers.ts` — `filterHeaders(headers) -> Record<string, string>`

---

## Code Examples

### Crear Envelope

```typescript
// envelope.ts
import { ok, err } from "../lib/result.js";

interface Transport {
  method: "webhook" | "poll" | "stream" | "queue_bridge" | "agent";
  protocol: string;
  headers?: Record<string, string>;
}

interface BuildEnvelopeContext {
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  accountid: string;
  traceid: string;
  correlation_id: string;
  causation_id: string | null;
  idempotencykey: string;
  source: string;
  type: string;
  resource: string;
}

export function buildEnvelope(
  rawBody: unknown,
  transport: Transport,
  context: BuildEnvelopeContext
) {
  const now = new Date().toISOString();
  const ulid = generateUlid(); // implementar
  
  const envelope = {
    specversion: "1.0",
    id: ulid,
    source: context.source,
    type: context.type,
    resource: context.resource,
    time: now,
    traceid: context.traceid,
    causation_id: context.causation_id,
    correlation_id: context.correlation_id,
    tenant: context.tenant,
    producer: context.producer,
    domain: context.domain,
    channel: context.channel,
    provider: context.provider,
    accountid: context.accountid,
    idempotencykey: context.idempotencykey,
    transport,
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: JSON.stringify(rawBody).length,
      payload_checksum: sha256(JSON.stringify(rawBody)),
      payload: rawBody,
    },
  };
  
  return ok(envelope);
}
```

### Generar Subject

```typescript
// subject.ts
export function buildSubject(params: {
  tenant: string;
  producer: string;
  domain: string;
  channel: string;
  provider: string;
  kind: "ingress" | "agent_outbound" | "agent_action" | "agent_observation";
  version?: string;
}): string {
  const version = params.version ?? "v1";
  return `evt.${params.tenant}.${params.producer}.${params.domain}.${params.channel}.${params.provider}.${params.kind}.${version}`;
}

// Ejemplo:
const subject = buildSubject({
  tenant: "acme",
  producer: "coexistance",
  domain: "messaging",
  channel: "whatsapp",
  provider: "meta",
  kind: "ingress",
});
// Result: evt.acme.coexistance.messaging.whatsapp.meta.ingress.v1
```

### Calcular Idempotency Key

```typescript
// idempotency.ts
import { createHash } from "crypto";

export function computeIdempotencyKey(rawBody: unknown): string {
  // Canonical JSON: keys ordenados alfabéticamente
  const canonical = canonicalJson(rawBody);
  const hash = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hash}`;
}

function canonicalJson(obj: unknown): string {
  if (obj === null) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(",")}]`;
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sorted.map(k => `"${k}":${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return `{${pairs.join(",")}}`;
}
```

### Pipeline de Ingress

```typescript
// meta-ingress/index.ts
import { pipe } from "../../lib/pipe.js";
import { verifySignature } from "./verify.js";
import { validateStructure } from "./validate.js";
import { checkPayloadSize } from "./check-size.js";
import { buildEnvelope } from "./envelope.js";
import { publish } from "../../bus/publish.js";

export async function handleMetaWebhook(request: Request, context: Context) {
  const result = await pipe(
    verifySignature(request, context.secret),
    validateStructure,
    checkPayloadSize,
    (body) => buildEnvelope(body, {
      method: "webhook",
      protocol: "https",
      headers: filterHeaders(request.headers),
    }, context),
    publish
  );
  
  return result;
}
```

### Filtrar Headers

```typescript
// headers.ts
const ALLOWLIST = [
  "content-type",
  "x-hub-signature-256",
  "x-hub-signature",
  "x-request-id",
  "user-agent",
];

export function filterHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of ALLOWLIST) {
    if (headers[key]) {
      filtered[key] = headers[key];
    }
  }
  return filtered;
}
```

---

## Commands

```bash
# Validar estructura de envelope
node scripts/validate-envelope.js <envelope.json>

# Generar subject desde CLI
node scripts/build-subject.js --tenant=acme --channel=whatsapp --provider=meta

# Calcular idempotency key
node scripts/compute-idempotency.js <payload.json>
```

---

## Resources

- **Templates**: See [assets/](assets/) para templates de envelope, subject builder, y pipeline
- **Documentation**: See [references/](references/) para el documento completo de diseño
