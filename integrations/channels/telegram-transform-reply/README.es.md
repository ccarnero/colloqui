# telegram-transform-reply — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

La plataforma queda con una **cuenta de canal Telegram** (que activa el `TelegramProvider`
integrado para recibir y enviar) y un **workflow** llamado `telegram-transform-reply`. El
aprovisionamiento es **declarativo**: un único [`manifest.yaml`](./manifest.yaml) aplicado con la
CLI `yoizen` (sin scripts de setup). El comportamiento observable es el de un bot de auto-respuesta:
cada mensaje que alguien le escribe al bot dispara el workflow, que lo transforma (eco + timestamp
con milisegundos) y responde por Telegram **al mismo chat** que lo originó.

## Escenario de uso

Un equipo quiere un bot de Telegram que confirme la recepción de cada mensaje — el esqueleto de
cualquier bot de atención: acusar recibo, clasificar, derivar. Este sample implementa la versión
mínima (eco con timestamp) usando exclusivamente piezas de plataforma: una cuenta de canal que
activa el proveedor integrado y un workflow de dos pasos. Sobre esta base, reemplazar el paso
`transform` por una llamada a un clasificador o a un LLM convierte el eco en un bot real, sin
tocar la infraestructura de ingesta ni de egreso.

Traza de ejemplo:

```
Usuario → bot: "hola"
Bot → usuario: "Echo: hola — processed at 2026-07-03T11:22:33.456Z (epoch_ms=1783250553456)"
```

## Cómo funciona por dentro

### Lo que provisiona manifest.yaml

| Recurso | Qué es |
| --- | --- |
| Canal (`telegram-transform-reply-bot`) | Cuenta Telegram, dirección `inbound`; activa el `TelegramProvider`. El `appSecret` (secreto de webhook) lo genera channel-service; el **bot token** se entrega vía el binding de secreto `telegram-bot-token` con `--secrets-from-env` (nunca en el repo). |
| Workflow (`telegram-transform-reply`) | `transform` (jsFunction) + `reply` (channelSend), con trigger `message_received` sobre el canal `telegram`. |
| Secreto (binding `telegram-bot-token`) | Alcance `channel:telegram-transform-reply-bot`. Solo nombre + alcance; el VALOR llega por variable de entorno al aplicar. |

> **Nota sobre el alcance del trigger.** El script anterior fijaba (pin) el trigger a un id de
> cuenta concreto (`TG_PIN=1`). Un manifest no puede expresar un id de cuenta que todavía no
> existe (manifest v1 no tiene sustitución de ids en tiempo de aplicación), así que el manifest usa
> el trigger sin pin: dispara con cualquier mensaje Telegram del tenant. En un tenant con una sola
> cuenta Telegram el comportamiento es equivalente.

### Anatomía del workflow

```
Telegram msg ─► trigger (message_received, channels:["telegram"], providers:["telegram"])
                  │
                  ▼
                transform   jsFunction — lee ctx.request.text, retorna
                  │         { text: "Echo: <texto> — processed at <ISO ms> (epoch_ms=...)" }
                  ▼
                reply       channelSend telegram
                            to        = {{request.from}}                (chat_id del emisor)
                            accountId = {{request.envelope.accountId}}  (cuenta del mensaje entrante)
                            text      = {{results.transform.text}}
```

Conceptos de plataforma involucrados:

- **Credenciales separadas para recibir y enviar.** RECEIVE se autentica con el `appSecret` de la
  cuenta (Telegram lo manda en el header `x-telegram-bot-api-secret-token`); SEND usa el **bot
  token** almacenado en la cuenta. Que la entrada funcione no prueba nada sobre la salida.
- **Reply account-agnóstico.** `accountId: {{request.envelope.accountId}}` toma la cuenta del
  propio mensaje entrante, así el workflow sigue siendo válido aunque la cuenta se recree.
  `to: {{request.from}}` funciona porque en chats privados el `from.id` de Telegram es el
  `chat_id`. Estas plantillas se resuelven **por petición** en workflow-service, por eso viajan
  literales en el manifest.
- **Coerción String() del templating.** `transform` retorna un string plano (`text`) que `reply`
  consume vía `{{results.transform.text}}` — no se pasan objetos anidados.

### Flujo de mensaje de punta a punta

| # | Desde | Transporte | Subject / URL | Hacia |
|---|-------|------------|---------------|-------|
| 1 | Telegram | HTTPS POST + `x-telegram-bot-api-secret-token` | `/api/webhooks/telegram/acme/<externalId>` | api-gateway |
| 2 | api-gateway | NATS JetStream (`INGRESS-ACME`) | `evt.acme.api-gateway.messaging.telegram.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingreso) | NATS JetStream | `evt.acme.channel-service.messaging.telegram.telegram.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · `runWorkflow` | worker de workflow-service |
| 5 | worker · `jsFunction` (transform) | local (in-process) | `workflow-orchestrator` | mismo worker |
| 6 | worker · `channelSend` (reply) | NATS core, capturado por `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 7 | channel-service-worker (egreso) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

`channel-service-worker` maneja tanto el ingreso (pasos 2–3) como el egreso (pasos 6–7); el pod
API (`channel-service-api`) solo administra cuentas y configuración. `jsFunction` y `channelSend`
corren in-process en el worker `workflow-orchestrator` — no hay salto por `connector-runtime`.

## Qué demuestra técnicamente

- Canal Telegram por configuración pura: una cuenta activa el `TelegramProvider` integrado para
  recibir y enviar, sin escribir adaptadores.
- Aprovisionamiento **declarativo**: todo el estado (canal + workflow + binding de secreto) vive en
  un `manifest.yaml` reconciliado por provisioning-service (plan/apply idempotente).
- Verificación del webhook por `appSecret` vs. envío por bot token (credenciales independientes).
- Ruteo de respuesta al mismo chat vía `{{request.from}}` y cuenta dinámica vía
  `{{request.envelope.accountId}}`.
- Persistencia real: la cuenta vive en Postgres por tenant y el workflow en Mongo — ambos
  sobreviven reinicios y redeploys.
- Trazabilidad completa: cada salto persiste `correlation_id` / `causation_id` / `trace_id`,
  consultables vía `/api/audit/channel-events` y `/api/audit/events`.

## Prerrequisitos

- Clúster dev corriendo con el tenant provisionado (`acme` por defecto), accesible (p. ej.
  port-forward de Kourier en `localhost:8080`).
- Un token **real** de Telegram de [@BotFather](https://t.me/BotFather) — requerido para enviar.
- La CLI `yoizen` disponible. Por única vez: `cd sdk && bun link` (después `yoizen ...` funciona en
  cualquier lado), o correrla directo sin linkear con `cd sdk && bun run bin/yoizen.ts ...`.
- Entorno para la CLI (misma precedencia que el cliente SDK): `YOIZEN_BASE_URL`,
  `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT` (`acme`), `YOIZEN_EMAIL`, `YOIZEN_PASSWORD`.
- La variable de entorno con el VALOR del secreto, leída literal por `--secrets-from-env` (el
  nombre del binding ES el nombre de la variable — sin transformación): `telegram-bot-token`.

## Aprovisionar (declarativo)

Validar el manifest, previsualizar el plan y aplicar — entregando el valor del secreto desde el
entorno (nunca desde el repo). El nombre del binding lleva guion, así que se pasa vía `env`:

```bash
cd sdk && bun link           # por única vez; o prefijá cada llamada con `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/channels/telegram-transform-reply/manifest.yaml
yoizen manifests plan     -f ../integrations/channels/telegram-transform-reply/manifest.yaml
env 'telegram-bot-token=123456:ABC-tu-bot-token' \
  yoizen manifests apply  -f ../integrations/channels/telegram-transform-reply/manifest.yaml --secrets-from-env
```

`plan` imprime una tabla de veredicto por recurso (create/update/noop); un segundo `apply` es un
no-op una vez convergido. Para rotar el token, re-ejecutar `apply` con un nuevo valor de
`telegram-bot-token`.

## Cómo ejecutarlo y qué esperar

Después de aplicar, escribirle al bot y recibir
`Echo: <texto> — processed at <ISO ms> (epoch_ms=...)`.

Para **entrada real**, Telegram necesita una URL HTTPS pública que alcance el gateway (nunca llama
a `localhost`). Registrar el webhook una vez contra el path por instancia
`/api/webhooks/telegram/<tenant>/<externalId>` (externalId `manifest:telegram-transform-reply-bot`),
usando el `appSecret` de la cuenta como `secret_token`:

```bash
# appSecret: consultá la cuenta después de aplicar (p. ej. GET /api/channels/accounts en el gateway)
curl -s "https://api.telegram.org/bot<token>/setWebhook" \
  --data-urlencode "url=https://<tu-host-publico>/api/webhooks/telegram/acme/manifest:telegram-transform-reply-bot" \
  --data-urlencode "secret_token=<appSecret>"
```

Para probar la cadena **sin** URL pública (inyecta un update sintético directo al gateway), usá el
driver de ejecución — necesita el secreto de webhook de la cuenta y un chat id real:

```bash
cd integrations/channels/telegram-transform-reply
TELEGRAM_WEBHOOK_SECRET=<appSecret> TELEGRAM_TEST_CHAT_ID=<chat-id-real> ./run.sh
```

`TELEGRAM_TEST_CHAT_ID` debe ser un chat real que ya haya hecho `/start` con el bot (un id falso
hace correr el workflow igual, pero Telegram rechaza la respuesta con `Bad Request: chat not
found`). El driver espera hasta 60 s una ejecución del workflow y la imprime (`id`, `status`,
tiempos).

## Detalles y advertencias

- **Recibir funciona pero el bot no responde.** Causa típica: token placeholder o inválido —
  Telegram devuelve `404` en cada send. Revisar el log de egreso del `channel-service-worker`.
  Tabla rápida: `404` token malo → re-`apply` con el valor real de `telegram-bot-token`; `401`
  token revocado → re-emitir en @BotFather y re-`apply`; `400 chat not found` → el destinatario no
  hizo `/start`; `circuit_open` → el circuit breaker de egreso se disparó, se limpia con
  `kubectl rollout restart deploy/channel-service-worker -n <ns>`.
- **El path del webhook lleva `/api`.** El prefijo global del gateway hace que la ruta real sea
  `/api/webhooks/telegram/<tenant>/<externalId>`; la auto-registración de la plataforma omite
  `/api` y Telegram termina en 404. Registrar el webhook con `setWebhook` como se muestra arriba.
- **El `appSecret` solo se devuelve al crear la cuenta.** Consultá la cuenta después de aplicar
  para obtenerlo; es el `secret_token` del webhook y el `TELEGRAM_WEBHOOK_SECRET` del driver.
- **El trigger del manifest no tiene pin.** `trigger.config` es
  `{channels:["telegram"], providers:["telegram"]}` (sin `accountIds`), por la ausencia de
  sustitución de ids en tiempo de aplicación en manifest v1.
- **Persistencia.** La cuenta vive en Postgres por tenant y el workflow en Mongo; re-aplicar el
  manifest reconcilia (idempotente, un re-apply convergido es no-op).
