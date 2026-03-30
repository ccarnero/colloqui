# Etapa 1 — Bus core: validación, subject, utilidades

## Objetivo
Crear los building blocks puros del módulo bus. Todas funciones puras sin side effects, sin dependencias externas. Son la base de todo lo que viene después.

## Archivos a crear

### server/src/bus/validate-envelope.js

```
Implementa validateEnvelope(obj) → Result

Retorna ok(true) si el objeto tiene la forma correcta de un envelope, err(razón) si no.

Campos requeridos (todos string excepto donde se indique):
  specversion, id, source, type, resource, time, traceid,
  causation_id (string o null), correlation_id,
  tenant, producer, domain, channel, provider, accountid,
  idempotencykey, transport (object), data (object)

Dentro de transport: method (string) y protocol (string) son requeridos.

Dentro de data: received_at (string), payload_inline (boolean), payload_bytes (number), payload_checksum (string) son requeridos.
  payload_ref (string o null), payload (any o null).

Reglas de validación:
- Si payload_inline es true, payload no puede ser null.
- Si payload_inline es false, payload_ref no puede ser null.
- No validar el contenido del payload — solo la estructura del envelope.
- Mensajes de error descriptivos: "missing required field: tenant", "transport.method is required", etc.

import { ok, err } from '../lib/result.js'
```

### server/src/bus/build-subject.js

```
Implementa buildSubject({ tenant, producer, domain, channel, provider, kind, version }) → Result

Formato: evt.${tenant}.${producer}.${domain}.${channel}.${provider}.${kind}.v${version}

Validaciones:
- Ningún parámetro puede contener puntos (son separadores de NATS). Si alguno tiene, retornar err con el campo problemático.
- Ningún parámetro puede estar vacío.
- version default: 1

Retorna ok(subject) o err(razón).

import { ok, err } from '../lib/result.js'
```

### server/src/bus/idempotency-key.js

```
Implementa idempotencyKey(rawBody) → string

Genera sha256 del JSON canonicalizado (JSON.stringify con keys sorted) del raw body.
Retorna "sha256:{hash}"
Usa Bun.CryptoHasher('sha256') — NO crypto de Node.
Función pura, sin side effects.

Helper interno para sorted keys:
  const canonical = JSON.stringify(rawBody, Object.keys(rawBody).sort())
```

### server/src/bus/check-payload-size.js

```
Implementa checkPayloadSize(rawBody, threshold = 262144) → { inline: boolean, bytes: number }

threshold default: 262144 (256 KB)
Calcula bytes con Buffer.byteLength(JSON.stringify(rawBody))
Retorna { inline: true, bytes } si está bajo el umbral, { inline: false, bytes } si lo supera.

En v0 el claim check no está implementado, pero esta función prepara el camino.
```

### server/src/bus/filter-headers.js

```
Implementa filterHeaders(headers, allowlist) → Record<string, string> filtrado

headers viene como objeto (como req.headers de Express, keys en lowercase)
allowlist default: ['content-type', 'x-hub-signature-256', 'x-hub-signature', 'x-request-id', 'user-agent']
Normaliza todas las keys a lowercase antes de filtrar.
Retorna nuevo objeto solo con los headers permitidos que existan en el input.
Función pura.
```

## Tests a crear

```
server/tests/bus/validate-envelope.test.js
server/tests/bus/build-subject.test.js
server/tests/bus/idempotency-key.test.js
server/tests/bus/check-payload-size.test.js
server/tests/bus/filter-headers.test.js
```

Casos de test por función:
- **validate-envelope**: envelope válido, cada campo requerido faltante, campos con tipo incorrecto, payload_inline true con payload null, payload_inline false con payload_ref null
- **build-subject**: subject válido, campo con punto, campo vacío, sin version (default 1)
- **idempotency-key**: determinista (mismo input = mismo output), distinto input = distinto output, formato "sha256:..."
- **check-payload-size**: body 1KB → inline:true, body 300KB → inline:false, threshold custom
- **filter-headers**: headers permitidos pasan, no permitidos se dropean, keys con mayúsculas se normalizan

## Verificación

```bash
bun test server/tests/bus/
```

Todos los tests deben pasar. Cero dependencias externas en esta etapa.
