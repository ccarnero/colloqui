# Etapa 6 — Tests de integración + smoke test E2E

## Objetivo
Tests de integración que verifican el flujo completo: webhook → NATS → consumer → MongoDB, y un smoke test script ejecutable.

## Fixtures a crear (si no existen de etapas anteriores)

### server/tests/bus/fixtures/meta-webhook-samples.js

```
Exporta tres fixtures que representan el raw POST body que Meta envía al webhook.
Copiar la estructura exacta del body que consume parseWebhook en src/meta/parse-webhook.js.

export const textMessage = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_ID',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
        contacts: [{ profile: { name: 'Test User' }, wa_id: '5491155551234' }],
        messages: [{
          from: '5491155551234',
          id: 'wamid.XXXX',
          timestamp: '1234567890',
          type: 'text',
          text: { body: 'Hola, necesito ayuda' },
        }],
      },
      field: 'messages',
    }],
  }],
}

export const imageMessage = {
  // Same structure but with type: 'image' and image: { id, mime_type, sha256 }
}

export const statusUpdate = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_ID',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15551234567', phone_number_id: 'PHONE_ID' },
        statuses: [{
          id: 'wamid.XXXX',
          status: 'delivered',
          timestamp: '1234567890',
          recipient_id: '5491155551234',
        }],
      },
      field: 'messages',
    }],
  }],
}
```

## Tests de integración a crear

### server/tests/bus/integration/full-pipeline.test.js

```
Test del flujo completo con NATS mockeado:

1. Simula un webhook POST con textMessage fixture
2. processIngress publica a NATS mock
3. El NATS mock entrega el mensaje al handler de persist-message
4. Verifica que saveMessage fue llamado con los datos correctos
5. Verifica que upsertContact fue llamado
6. Verifica los logs de cada step

Mockear: nc (NATS connection), db (MongoDB collections)
NO mockear: processIngress, buildEnvelope, validateEnvelope, buildSubject (ejecutar real)

Este test verifica que todas las piezas encajan correctamente.
```

### server/tests/bus/integration/graceful-degradation.test.js

```
Verificar que el sistema funciona correctamente cuando NATS no está disponible:

1. connectNats con URL inválida → retorna err
2. nc es null → webhook logea warning y no crashea
3. Server arranca sin NATS → health endpoint muestra nats: 'disconnected'
```

## Smoke test script

### server/src/scripts/smoke-test-nats.js

```
Idempotente. Se ejecuta con: bun src/scripts/smoke-test-nats.js

El script:
1. Se conecta a NATS (usa NATS_URL de env o default localhost:4222)
2. Crea un subscriber temporal en 'evt.test.coexistance.messaging.whatsapp.meta.ingress.v1'
3. Publica un evento de prueba usando processIngress con el fixture textMessage
4. Espera max 3 segundos a que el subscriber reciba el mensaje
5. Verifica que lo recibió e imprime el envelope formateado
6. Cierra la conexión

Si NATS no está disponible, imprime un mensaje claro y sale con código 0 (no es error):
  [SMOKE] Cannot connect to NATS at nats://localhost:4222 — skipping (not an error)

Output esperado:
  [SMOKE] Connecting to nats://localhost:4222...
  [SMOKE] Connected
  [SMOKE] Subscribed to evt.test.coexistance.messaging.whatsapp.meta.ingress.v1
  [SMOKE] Publishing test event...
  [NATS] Published 01JQXXXX... to evt.test.coexistance... (xxx bytes)
  [SMOKE] Received event:
  {
    id: "01JQXXXX...",
    type: "io.yoizen.messaging.ingress.received.v1",
    tenant: "test",
    channel: "whatsapp",
    provider: "meta",
    data: { payload_bytes: xxx, payload_inline: true }
  }
  [SMOKE] OK — NATS ingress pipeline working

Cleanup: cerrar subscriber y conexión con nc.drain() al final.
```

## Verificación

```bash
# Unit + integration tests
bun test server/tests/bus/

# Smoke test (requiere NATS corriendo en localhost:4222)
bun src/scripts/smoke-test-nats.js

# Si no tenés NATS local, con Docker:
docker run -d --name nats -p 4222:4222 nats:latest
bun src/scripts/smoke-test-nats.js
docker stop nats && docker rm nats
```
