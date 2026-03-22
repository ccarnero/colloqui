# NATS Ingress Design Notes

## Context

Queremos empezar a usar el NATS del cluster de Kubernetes como message bus para
`coexistance`.

Primer objetivo:

- el webhook debe seguir haciendo lo que hace hoy
- ademas debe publicar al bus
- por ahora solo estamos cerrando diseno, no implementacion

Flujo actual:

- `webhook -> parse -> Mongo -> websocket`

Primer paso deseado:

- `webhook -> parse -> Mongo -> websocket + publish bus`

## Restriccion principal

El bus no es exclusivo de WhatsApp ni de este servicio.

Debe servir para:

- multiples servicios
- multiples tenants
- multiples canales
- multiples providers

Ejemplos futuros:

- WhatsApp
- Instagram
- X/Twitter
- TikTok

Por eso, el contrato del bus no debe quedar acoplado a un payload normalizado
solo para WhatsApp.

## Conclusiones actuales

- no conviene que el contrato base del bus sea WhatsApp-only
- tampoco conviene publicar solamente el raw del provider sin envelope comun
- la mejor direccion actual es: `envelope estable y generico + payload raw intacto`
- el routing debe vivir en el `subject` de NATS, no escondido en el body
- para este flujo conviene arrancar con `JetStream`, no solo Core NATS
- el primer paso debe convivir con Mongo + websocket sin romper lo actual

En resumen:

- `raw` si
- `raw-only` no
- `normalized-only` tampoco como contrato inicial del bus

## Por que conservar el raw

Queremos preservar exactamente lo que llega del provider porque:

- evita perdida de datos utiles para metricas o features futuras
- permite reprocesar si cambia la interpretacion
- desacopla la captura del evento de la logica de negocio
- evita tener que corregir historicos si cambia el mapping
- permite subscribers especializados en WhatsApp que quieran usar todos los campos

## Por que agregar un envelope comun

Aunque el payload sea raw, el bus compartido necesita metadata estable para:

- routing
- observabilidad
- correlacion
- deduplicacion
- seguridad y ACLs
- multi-tenant
- trazabilidad cross-service

El raw payload del provider no trae de forma consistente todo eso.

## Modelo recomendado por ahora

### Capa 1 - evento de ingress generico

Publicar un evento generico de ingress con envelope estable y raw payload del
provider intacto.

### Capa 2 - eventos derivados

Mas adelante, si hace falta, otro proceso puede consumir el raw ingress y
publicar eventos derivados o canonicos mas especificos.

Ejemplos futuros:

- `message.received`
- `status.updated`
- `conversation.updated`
- `agent.intent.detected`

Pero esos no son el primer contrato a cerrar hoy.

## Subject design

En NATS el routing debe vivir en el `subject`, no en un `routing_key` dentro del
payload.

Propuesta de subject generico:

`evt.<env>.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v1`

Ejemplo para este caso:

`evt.dev.acme.coexistance.messaging.whatsapp.meta.ingress.v1`

Ventajas:

- escala a multiples canales
- escala a multiples providers
- facilita wildcard subscriptions
- permite ACL por tenant
- evita parsear payload para decisiones basicas de routing

Ejemplos futuros:

- `evt.dev.acme.coexistance.messaging.instagram.meta.ingress.v1`
- `evt.dev.acme.coexistance.messaging.tiktok.bytedance.ingress.v1`

## Envelope recomendado

Base conceptual inspirada en CloudEvents 1.0, adaptada al bus interno.

Campos minimos recomendados:

- `specversion`
- `id`
- `source`
- `type`
- `subject`
- `time`
- `tenant`
- `producer`
- `domain`
- `channel`
- `provider`
- `accountid`
- `idempotencykey`
- `data`

Ejemplo conceptual:

```json
{
  "specversion": "1.0",
  "id": "01JQXXXX",
  "source": "/services/coexistance/webhooks/meta/whatsapp",
  "type": "io.yoizen.messaging.ingress.received.v1",
  "subject": "tenant/acme/account/69bea8cd868e860918359cc7/channel/whatsapp/provider/meta",
  "time": "2026-03-21T15:40:11.382Z",
  "dataschema": "https://schemas.yoizen.dev/messaging/ingress/received/v1.json",
  "tenant": "acme",
  "producer": "coexistance",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:...",
  "data": {
    "received_at": "2026-03-21T15:40:11.382Z",
    "http": {
      "path": "/api/webhooks/whatsapp",
      "headers": {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=..."
      }
    },
    "payload": {
      "...": "raw meta webhook body"
    }
  }
}
```

## Decision importante

El raw de Meta debe viajar intacto dentro de `data.payload`.

No se recomienda que el raw body de Meta sea el evento completo del bus sin
envelope.

## Broker recomendado

Para este caso, la preferencia actual es:

- `JetStream` primero
- no Core NATS como base del flujo

Razones:

- durabilidad
- replay
- tolerancia a caidas
- desacople de consumidores
- mejor soporte para eventos de integracion

## Estrategia inicial de adopcion

Primer paso conceptual:

- mantener el flujo actual como esta
- agregar publish al bus en paralelo

O sea:

- Mongo sigue siendo la persistencia actual
- websocket sigue siendo el mecanismo actual de UI
- NATS entra como shadow publish inicial

## Granularidad del evento - punto abierto

Este es el punto principal pendiente de definicion.

### Opcion A - 1 mensaje por POST raw recibido

Publicar exactamente un evento por cada `POST /api/webhooks/whatsapp`.

Ventajas:

- maxima fidelidad al provider
- preserva completamente el boundary real de ingress
- no pierde contexto entre `entry`, `changes`, `messages`, `statuses`
- facilita replay exacto

Desventajas:

- los consumers deben saber partir el payload
- menos comodidad para consumidores de negocio

### Opcion B - 1 mensaje por evento logico interno

Publicar un mensaje separado por cada item logico:

- mensaje inbound
- status update
- etc.

Ventajas:

- mas simple para algunos consumidores
- ya sale semi procesado

Desventajas:

- ya no es raw ingress puro
- obliga al productor a reinterpretar y fragmentar
- si el mapping cambia, hay que versionar o reprocesar

## Recomendacion actual sobre granularidad

Default recomendado por ahora:

- publicar 1 mensaje por POST raw recibido

Y si luego hace falta:

- agregar un splitter o consumer que derive eventos mas granulares

## Riesgos y consideraciones detectadas

Antes de volver el bus mas central, hay que recordar:

- el codigo actual procesa solo parte del webhook en algunos caminos
- la deduplicacion todavia no esta endurecida end-to-end
- hay que definir politica de PII en el bus compartido
- hay que definir retencion de JetStream
- hay que decidir si guardar todos los headers HTTP o solo un subconjunto

## Preguntas abiertas para la proxima discusion

1. Confirmamos que el primer evento del bus representa el `POST raw` completo?
2. Que campos del HTTP envelope queremos conservar ademas del body?
3. Que politica de PII aplica para un bus compartido entre tenants y servicios?
4. Que parte del routing debe ir en `subject` y que parte en `data`?
5. Queremos publicar luego eventos derivados ademas del raw ingress?

## Estado actual de consenso

Consensos alcanzados:

- el contrato base no debe quedar acoplado solo a WhatsApp
- el raw payload del provider no debe perderse
- el bus necesita envelope comun
- NATS debe usar routing por `subject`
- JetStream es mejor opcion inicial
- el primer paso debe convivir con Mongo + websocket actuales

Pendiente principal:

- cerrar la granularidad del evento inicial
