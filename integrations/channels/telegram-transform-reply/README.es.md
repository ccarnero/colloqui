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

> **Nota sobre el alcance del trigger.** El trigger está pineado a la cuenta propia de este
> manifest (`telegram-transform-reply-bot`) vía `trigger.config.accountIds:
> [{channelRef: telegram-transform-reply-bot}]` — la sustitución de arreglo `accountIds`
> (`ARRAY_SUBSTITUTION_ALLOWLIST`). Ningún otro workflow disparado por Telegram dispara con el
> tráfico de esta cuenta.

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

> **Causa raíz y por qué a veces hay que hacerlo a mano.** `channel-service`
> ya auto-registra el webhook al crear la cuenta (`registerTelegramWebhook`,
> `services/channel-service/src/modules/accounts/accounts.service.ts`), usando
> `channelServiceConfig.channelServicePublicUrl` (el getter de
> `CHANNEL_SERVICE_PUBLIC_URL` en `services/channel-service/src/config.ts`) como base de la URL. Si
> `CHANNEL_SERVICE_PUBLIC_URL` no está seteada en el deployment, esa base cae
> a la URL interna `http://` del clúster — Telegram rechaza `setWebhook` con
> `bad webhook: An HTTPS URL must be provided`, así que la cuenta queda
> **sin ningún webhook** y los mensajes entrantes quedan encolados del lado
> de Telegram hasta registrarlo a mano. Una vez que `CHANNEL_SERVICE_PUBLIC_URL`
> está seteada (p. ej. `https://api.devmachina.net/api`) en `channel-service`,
> la auto-registración funciona al crear la cuenta y este paso manual
> desaparece por completo.
>
> `apply` no expone el `appSecret` auto-generado de la cuenta en su propia
> salida. La forma principal de leerlo es el endpoint autenticado del
> gateway `GET /api/channels/accounts/<id>`, que devuelve `appSecret` en el
> DTO de la cuenta (el mapper fila→DTO de
> `services/channel-service/src/modules/accounts/accounts.service.ts` pasa `app_secret` tal cual).
> Usando el helper `auth()` definido en la sección de Troubleshooting del
> README en inglés (headers bearer + `x-yoizen-tenant`):
>
> ```bash
> # listar cuentas, encontrar la de externalId manifest:telegram-transform-reply-bot, leer su appSecret
> auth "$GW/api/channels/accounts" \
>   | jq -r '.[] | select(.externalId=="manifest:telegram-transform-reply-bot") | .appSecret'
> ```
>
> Fallback de dev — si no tenés un token bearer a mano, leelo directo de
> Postgres:
>
> ```bash
> kubectl exec -n support-services-dev postgres-shared-1 -c postgres -- \
>   psql -U postgres -d tenant_acme -At -c \
>   "SELECT app_secret FROM channel_accounts WHERE external_id='manifest:telegram-transform-reply-bot';"
> ```
>
> Llamada completa de registro usada para remediar esto en vivo (body JSON,
> incluye `allowed_updates`/`max_connections`):
>
> ```bash
> curl -X POST "https://api.telegram.org/bot<token>/setWebhook" \
>   -H 'Content-Type: application/json' \
>   -d '{
>     "url": "https://api.devmachina.net/api/webhooks/telegram/acme/manifest:telegram-transform-reply-bot",
>     "secret_token": "<appSecret de la consulta de arriba>",
>     "allowed_updates": ["message", "channel_post"],
>     "max_connections": 40
>   }'
> ```

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

### Entorno (solo el driver de ejecución)

`run.sh` sourcea `../../lib/resolve-env.sh`, que carga un `.env` local de este directorio y exporta
las coordenadas `YOIZEN_*`. `src/index.ts` lee exactamente estas:

| Var | Default | Notas |
| --- | --- | --- |
| `TELEGRAM_WEBHOOK_SECRET` | — (**requerida**) | El `appSecret` de la cuenta; firma el update sintético |
| `TELEGRAM_TEST_CHAT_ID` | — (**requerida**) | Chat id numérico real que ya hizo `/start` |
| `TG_EXTERNAL_ID` | `manifest:telegram-transform-reply-bot` | externalId derivado por el motor de apply |
| `TG_WORKFLOW_NAME` | `telegram-transform-reply` | Debe coincidir con el workflow del `manifest.yaml` |
| `TG_POLL_TIMEOUT_S` | `60` | Cuánto esperar una ejecución |

> El `.env.example` que se distribuye refleja esta tabla. Dos de sus entradas son históricas y no
> las lee nadie acá: `TG_PUBLIC_URL` (el webhook lo auto-registra `channel-service`, o se registra
> a mano — ver arriba) y el viejo switch `SIMULATE_INBOUND`, que ya no existe: `run.sh` siempre
> inyecta el update sintético. `TELEGRAM_BOT_TOKEN` en el `.env` tampoco llega a la cuenta: el
> token viaja solo como binding `telegram-bot-token` en la línea de `apply`.

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
- **El `appSecret` no lo expone `apply`, pero SÍ la API de cuentas.** El mapper fila→DTO de
  `accounts.service.ts` pasa `app_secret` tal cual, así que tanto `GET /api/channels/accounts`
  como `GET /api/channels/accounts/<id>` lo devuelven en cualquier momento (solo
  `POST /channels/accounts/:id/refresh-token` enmascara su token). Es el `secret_token` del webhook
  y el `TELEGRAM_WEBHOOK_SECRET` del driver.
- **El trigger SÍ está pineado.** `trigger.config` incluye
  `accountIds: [{channelRef: telegram-transform-reply-bot}]` — la sustitución de arreglo llegó con
  `ARRAY_SUBSTITUTION_ALLOWLIST` (ver la nota de arriba); la afirmación contraria de versiones
  previas de este documento era anterior a esa capacidad.
- **Persistencia.** La cuenta vive en Postgres por tenant y el workflow en Mongo; re-aplicar el
  manifest reconcilia (idempotente, un re-apply convergido es no-op).
