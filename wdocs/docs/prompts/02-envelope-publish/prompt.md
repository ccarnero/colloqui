# Etapa 2 — Envelope builder + conexión NATS + publish

## Objetivo
Construir envelopes completos, conectar a NATS, y publicar eventos. Primera etapa con dependencia externa (nats).

## Dependencia

```bash
bun add nats ulid
```

## Archivos a crear

### server/src/bus/build-envelope.js

```
Implementa buildEnvelope(rawBody, transport, context) → Result con el envelope completo.

Instalar: bun add ulid

context es un objeto con:
  { tenant, accountid, producer, traceid, correlationId, causationId, source, type, channel, provider, domain }

La función:
1. Genera id con ulid() — import { ulid } from 'ulid'
2. Genera time con new Date().toISOString()
3. Calcula idempotencykey con idempotencyKey(rawBody) — import de ./idempotency-key.js
4. Calcula payload_bytes con Buffer.byteLength(JSON.stringify(rawBody))
5. Calcula payload_checksum con el mismo sha256: "sha256:{hash}"
6. En v0, payload_inline siempre es true y payload_ref siempre es null (no hay claim check)
7. Arma el envelope con todos los campos:
   - specversion: "1.0"
   - id: ulid generado
   - source: context.source
   - type: context.type
   - resource: `tenant/${tenant}/account/${accountid}/channel/${channel}/provider/${provider}`
   - time: ISO string
   - traceid: context.traceid
   - causation_id: context.causationId || null
   - correlation_id: context.correlationId
   - tenant, producer, domain, channel, provider, accountid: del context
   - idempotencykey: calculado
   - transport: pasado como argumento
   - data: { received_at: time, payload_inline: true, payload_ref: null, payload_bytes, payload_checksum, payload: rawBody }
8. Valida el envelope con validateEnvelope() — import de ./validate-envelope.js
9. Si la validación falla, retorna err con la razón
10. Si pasa, retorna ok(envelope)

import { ok, err } from '../lib/result.js'
```

### server/src/bus/connect-nats.js

```
Implementa connectNats(url) → Promise<Result> con la conexión NATS.

url default: 'nats://localhost:4222'
Usa: import { connect } from 'nats'

Log: console.log('  [NATS] Connected to', url) al conectar
Log: console.log('  [NATS] Closed') al cerrar (listener en nc.closed())

Retorna ok(nc) con la conexión, err(razón) si falla.

NO guardar la conexión en variable global. Se pasa como argumento a quien la necesite.

// NOTA en comentario:
// En v1 (JetStream), esta función también inicializará el JetStream context.
// El signature externo se mantiene igual — los callers no cambian.
```

### server/src/bus/publish-event.js

```
Implementa publishEvent(nc, subject, envelope) → Result

Serializa el envelope a JSON con StringCodec de nats.
Publica con nc.publish(subject, encodedPayload, { headers })

IMPORTANTE: setea el header Nats-Msg-Id con envelope.idempotencykey.
  Aunque Core NATS no usa este header, lo seteamos para que cuando se migre
  a JetStream la dedup funcione sin cambiar código.
  Usar: import { headers as createHeaders, StringCodec } from 'nats'
  const h = createHeaders()
  h.set('Nats-Msg-Id', envelope.idempotencykey)

Log: console.log(`  [NATS] Published ${envelope.id} to ${subject} (${envelope.data.payload_bytes} bytes)`)
Si falla: console.error(`  [NATS] Publish FAILED: ${error}`) y retorna err

Retorna ok({ eventId: envelope.id, subject, payloadBytes: envelope.data.payload_bytes })

// NOTA en comentario al inicio del archivo:
// En v1 (JetStream), esta función cambiará a usar js.publish() con ack wait.
// El signature externo se mantiene igual — los callers no cambian.
```

## Tests a crear

```
server/tests/bus/build-envelope.test.js
server/tests/bus/connect-nats.test.js
server/tests/bus/publish-event.test.js
```

- **build-envelope**: verificar envelope completo con fixture de Meta, verificar que pasa validateEnvelope, verificar que idempotencykey es consistente, verificar campo resource
- **connect-nats**: mockear nats.connect, verificar ok/err, verificar logs
- **publish-event**: mockear nc.publish, verificar header Nats-Msg-Id, verificar payload serializado, verificar resultado ok

## Verificación

```bash
bun test server/tests/bus/
```

Crear un fixture reutilizable en server/tests/bus/fixtures/meta-webhook-samples.js con:
- textMessage: POST body de Meta con un mensaje de texto simple
- imageMessage: POST body con mensaje de imagen
- statusUpdate: POST body con status delivered

Copiar la estructura del raw body de Meta que consume parseWebhook en src/meta/parse-webhook.js.
