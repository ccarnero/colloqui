# telegram-transform-reply — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de ejecutar `./setup.sh`, la plataforma queda con una **cuenta de canal Telegram** (que
activa el `TelegramProvider` integrado para recibir y enviar), un **workflow** llamado
`telegram-transform-reply` y, si se pasó `TG_PUBLIC_URL`, el **webhook registrado en Telegram**.
El comportamiento observable es el de un bot de auto-respuesta: cada mensaje que alguien le
escribe al bot dispara el workflow, que lo transforma (eco + timestamp con milisegundos) y
responde por Telegram **al mismo chat** que lo originó. A diferencia de `http-bridge`, no se
escribe ningún adaptador ni se usa `@yoizen/platform-sdk`: todo es configuración vía API.

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

### Lo que provisiona setup.sh (5 etapas + preflight)

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Verifica `jq`/`curl`; sin `TELEGRAM_BOT_TOKEN` usa un placeholder (provisiona pero los envíos devuelven 404) |
| 1 login | `POST /api/auth/login` con el usuario semilla del tenant; obtiene el bearer token |
| 2 account | Crea/reutiliza la cuenta Telegram (matcheo por **prefijo** de `externalId`); captura el `appSecret` y lo cachea en `.telegram-sample-secret` |
| 3 workflow | Crea/reutiliza el workflow `transform` + `reply`, con trigger fijado (pinning) a la cuenta (`TG_PIN=1` por defecto) |
| 4 webhook | Con `TG_PUBLIC_URL` + token real: llama `setWebhook` de Telegram con la URL por instancia y el `secret_token` |
| 5 simulate | Con `SIMULATE_INBOUND=1`: inyecta un update sintético firmado y espera una ejecución del workflow |

Idempotente: re-ejecutar reutiliza cuenta y workflow, y borra duplicados en cada corrida.
`RECREATE=1` reconstruye **ambos** desde cero (rota token, secret y pin juntos).

### Anatomía del workflow

```
Telegram msg ─► trigger (message_received, channels:["telegram"], accountIds:[<cuenta>])
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
  `chat_id`.
- **Trigger pinning por `accountIds`.** Con `TG_PIN=1`, solo los mensajes de esta cuenta disparan
  el workflow; `TG_PIN=0` lo abre a cualquier mensaje Telegram del tenant.
- **Coerción String() del templating.** `transform` retorna un string plano (`text`) que `reply`
  consume vía `{{results.transform.text}}` — no se pasan objetos anidados.
- **`externalId` con sufijo único.** La clave `(channel, external_id)` es única global y un
  delete puede no liberarla en dev; cada create agrega un sufijo único y el reuse matchea por
  prefijo (`TG_EXTERNAL_ID`), evitando el 500 duplicate-key.

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
- Verificación del webhook por `appSecret` vs. envío por bot token (credenciales independientes).
- Ruteo de respuesta al mismo chat vía `{{request.from}}` y cuenta dinámica vía
  `{{request.envelope.accountId}}`.
- Persistencia real: la cuenta vive en Postgres por tenant y el workflow en Mongo — ambos
  sobreviven reinicios y redeploys.
- Trazabilidad completa: cada salto persiste `correlation_id` / `causation_id` / `trace_id`,
  consultables vía `/api/audit/channel-events` y `/api/audit/events`.

Referencias de contrato (verificadas en código): `services/channel-service/src/modules/accounts/accounts.dto.ts`
+ `accounts.service.ts` (cuenta de canal), `services/channel-service/src/providers/telegram/telegram.provider.ts`
(`parseTelegramMessage`, `from` = chat id), `services/api-gateway/src/modules/channels/webhooks.controller.ts`
(webhook, prefijo global `api`), `services/workflow-service/src/temporal/workflows.ts` +
`trigger-consumer.service.ts` (ejecutor y matching del trigger).

## Cómo ejecutarlo y qué esperar

Prerrequisitos: clúster dev corriendo con el tenant provisionado, `jq`/`curl`, un token **real**
de @BotFather y — para entrada real — una URL HTTPS pública que Telegram pueda alcanzar (un túnel
cloudflared funciona bien; Telegram no llama a `localhost`).

```bash
cd integrations/channels/telegram-transform-reply
cp .env.example .env    # TELEGRAM_BOT_TOKEN=... y TG_PUBLIC_URL=https://... (solo base URL)
./setup.sh              # o ./run.sh, que exige el token y delega en setup.sh
```

Resultado esperado: escribirle al bot y recibir
`Echo: <texto> — processed at <ISO ms> (epoch_ms=...)`. Sin URL pública, la cadena se puede
probar igual inyectando un update sintético directo al gateway:

```bash
SIMULATE_INBOUND=1 TELEGRAM_TEST_CHAT_ID=<chat-id-real> ./setup.sh
```

El script espera hasta 60 s una ejecución del workflow y la imprime (`id`, `status`, tiempos).

## Detalles y advertencias

- **Recibir funciona pero el bot no responde.** Causa típica: token placeholder o inválido —
  Telegram devuelve `404` en cada send. Revisar el log de egreso del `channel-service-worker`.
  Tabla rápida: `404` token malo → re-ejecutar con token real + `RECREATE=1`; `401` token
  revocado → re-emitir en @BotFather; `400 chat not found` → el destinatario no hizo `/start`;
  `circuit_open` → el circuit breaker de egreso se disparó, se limpia con
  `kubectl rollout restart deploy/channel-service-worker -n <ns>`.
- **El path del webhook lleva `/api`.** El prefijo global del gateway hace que la ruta real sea
  `/api/webhooks/telegram/<tenant>/<externalId>`; la auto-registración de la plataforma omite
  `/api` y Telegram termina en 404. Pasar `TG_PUBLIC_URL` (solo la base; el script agrega el path
  y normaliza si se pega la URL completa) registra el webhook correcto.
- **Mensaje recibido pero sin evento `send`.** Suele ser un workflow con pin obsoleto:
  `trigger.config.accountIds` apunta a una cuenta borrada/rotada y el matcher descarta los
  mensajes de la nueva. `RECREATE=1` reconstruye cuenta y workflow juntos, dejando el pin al día.
- **El `appSecret` solo se devuelve al crear la cuenta.** Por eso se cachea en
  `.telegram-sample-secret` (gitignored); si se reutiliza una cuenta sin caché local, registrar el
  webhook o simular requiere una corrida con `RECREATE=1` para acuñar y cachear uno nuevo.
- **`SIMULATE_INBOUND=1` exige un `chat_id` real.** Con un id falso el workflow corre igual, pero
  Telegram rechaza la respuesta con `Bad Request: chat not found` — por eso el script falla rápido
  sin `TELEGRAM_TEST_CHAT_ID`.
- **Webhook activo vs. `getUpdates`.** Este sample registra el webhook del bot; a partir de ahí
  `getUpdates` devuelve 409 en otros samples (los scripts de `http-bridge` lo manejan borrando y
  restaurando el webhook durante el descubrimiento).
