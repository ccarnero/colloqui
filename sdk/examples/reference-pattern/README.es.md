# http-bridge — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de ejecutar `./setup.sh`, la plataforma queda con dos recursos nuevos: una **instancia de
canal HTTP dedicada** (cuenta con `externalId = http-bridge`, con su propia URL de ingesta y su
propio `appSecret`) y un **workflow** llamado `http-bridge`. El comportamiento observable es
simple: cualquier JSON que se envíe por POST a la URL de ingesta de esa instancia dispara el
workflow, que arma un eco del payload recibido (texto, remitente, metadata) con una marca de
tiempo, y lo envía como mensaje directo de Telegram a uno o dos destinatarios.

## Escenario de uso

Un sistema legado (un ERP, un monitor de alarmas, un cron antiguo) solo sabe hacer POST HTTP, pero
el equipo de operaciones vive en Telegram. Este patrón convierte ese POST en una notificación
inmediata: el sistema publica el evento en la URL de ingesta del canal HTTP y la plataforma lo
entrega al chat del equipo, sin escribir ningún servicio intermedio.

Traza de ejemplo:

```
POST {"from":"erp","text":"stock bajo SKU-42"}  →  workflow http-bridge
Telegram: "Echo: stock bajo SKU-42 (from=erp, metadata={}) — processed at 2026-07-03T11:22:33.456Z (epoch_ms=...)"
```

## Cómo funciona por dentro

### Lo que provisiona setup.sh (SDK-powered, `src/setup.ts`)

`setup.sh` es un wrapper delgado (resuelve el entorno en línea, sin depender de `integrations/lib`, e invoca
`npx tsx src/setup.ts`); la lógica real usa `@yoizen/platform-sdk` (`client.channels.*`,
`client.workflows.*`) en vez de `curl`+`jq`. El login queda a cargo de `createClient()` — no es
una etapa separada.

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Reporta la configuración efectiva (base URL, tenant, workflow, `RECREATE`) |
| 2 resolve | Resuelve la cuenta Telegram activa (o la fijada por `TG_ACCOUNT_ID`), auto-descubre los `chat_id` llamando directamente a `api.telegram.org` (`getUpdates`, fuera del SDK de la plataforma), y crea/reutiliza la instancia HTTP dedicada vía `client.channels.*` (capturando su `appSecret`) |
| 3 workflow | Crea el workflow `http-bridge` vía `client.workflows.create()` con el trigger fijado (pinning) a la instancia recién creada |

Con `RECREATE=1` (el valor por defecto en este sample) cada corrida borra y reconstruye la
instancia HTTP y el workflow, para que siempre incorporen los `chat_id` recién resueltos.

### Anatomía del workflow

```
HTTP msg ─► trigger (message_received, channels:["http"], accountIds:[<instancia http-bridge>])
              │
              ▼
            echo     jsFunction — lee ctx.request.{text,from,metadata},
              │      agrega timestamp ISO-8601 + epoch ms, retorna { text }
              ▼
            notify   branch (PARALELO, siempre dos ramas)
              ├── notifyPrimary    channelSend telegram → TELEGRAM_CHAT_ID
              └── notifySecondary  channelSend telegram → TELEGRAM_CHAT_ID_2
```

Conceptos de plataforma involucrados:

- **Instancia de canal HTTP dedicada.** El `externalId` es el último segmento de la URL de
  ingesta (`/api/webhooks/http/<tenant>/http-bridge`) y el `appSecret` de la cuenta es el valor
  del header `x-http-channel-token` que autentica cada POST.
- **Trigger pinning por `accountIds`.** Con `BRIDGE_PIN=1` (defecto), `trigger.config.accountIds`
  contiene solo el id de esta instancia, de modo que únicamente los mensajes dirigidos a su URL
  disparan el workflow — sin interferencia con otros workflows HTTP del tenant.
- **Coerción String() del templating.** El resolutor de `{{...}}` aplica `String(value)` a cada
  hoja, por eso `echo` retorna un string plano (`text`) que `notify` consume vía
  `{{results.echo.text}}` — no se pasan objetos anidados.
- **Branch paralelo obligatorio para multi-destinatario.** `channelSend.to` acepta un único
  string; para notificar a dos personas el workflow siempre construye un `branch` con un
  `channelSend` por rama.

### Flujo de mensaje de punta a punta

| # | Desde | Transporte | Subject / URL | Hacia |
|---|-------|------------|---------------|-------|
| 1 | Cliente HTTP | HTTPS POST + `x-http-channel-token` | `/api/webhooks/http/acme/http-bridge` | api-gateway |
| 2 | api-gateway | NATS JetStream (`INGRESS-ACME`) | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingreso) | NATS JetStream | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · `runWorkflow` | worker de workflow-service |
| 5 | worker · `jsFunction` (echo) | local (in-process) | `workflow-orchestrator` | mismo worker |
| 6 | worker · `channelSend` (notify) | NATS core, capturado por `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 7 | channel-service-worker (egreso) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

Aquí `jsFunction` y `channelSend` corren in-process en el worker `workflow-orchestrator`: no hay
salto por `connector-runtime` (a diferencia de `http-fanout-telegram`).

## Qué demuestra técnicamente

- Ingesta por canal HTTP con instancia dedicada y autenticación por `appSecret`.
- Trigger `message_received` con pinning por `accountIds` (aislamiento entre workflows HTTP).
- `jsFunction` con acceso completo a `ctx.request` y templating `{{...}}` con coerción a string.
- `branch` paralelo como mecanismo obligatorio de fan-out para múltiples `channelSend`.
- Auto-descubrimiento de `chat_id` de Telegram vía `getUpdates`, con manejo del conflicto webhook.

Referencias de contrato (verificadas en código): `services/workflow-service/src/temporal/workflows.ts`
(ejecutor y templating), `services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts`
(esquema de acciones), `services/workflow-service/src/temporal/activities/channel-send.activity.ts`
(`channelSend`), `services/api-gateway/src/modules/channels/webhooks.controller.ts` (webhook HTTP).

## Cómo ejecutarlo y qué esperar

Prerrequisitos: cuenta Telegram provisionada con token real
(`(cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)`) y que cada destinatario
haya enviado `/start` al bot (un bot no puede iniciar conversación por número de teléfono).

```bash
cd sdk/examples/reference-pattern
cp .env.example .env   # opcional — solo para fijar chat_ids u overrides
./setup.sh             # provisiona instancia + workflow, imprime URL y token
./run.sh               # resuelve el token y hace un POST de prueba
```

Resultado esperado: la respuesta HTTP es siempre `{"status":"accepted"}` (el workflow corre de
forma asíncrona) y segundos después llega el DM de Telegram con el eco y el timestamp. También se
puede hacer el POST manual con `curl` usando la URL y el `x-http-channel-token` que imprime
`setup.sh`.

## Detalles y advertencias

- **`channelSend.to` es un único string.** No existe forma de lista ni valores separados por
  comas; el multi-destinatario se resuelve con `branch`. Si no se encontró un segundo `chat_id`,
  `notifySecondary` queda apuntando al mismo chat que `notifyPrimary` — hay que editarlo luego en
  la UI del builder.
- **`RECREATE=1` por defecto.** Cada corrida rota la instancia (y por lo tanto el token
  `appSecret`) y reconstruye el workflow. Usar `RECREATE=0` para reutilizar por nombre.
- **Descubrimiento de chats vs. webhook activo.** `getUpdates` devuelve 409 si el bot tiene un
  webhook registrado (lo registra `telegram-transform-reply`). El script lo maneja: lee el webhook
  con `getWebhookInfo`, lo borra, sondea y lo restaura (`BRIDGE_RESTORE_WEBHOOK=1`). Importante:
  los mensajes ya entregados por el webhook **no se re-entregan** por `getUpdates` — hay que
  enviar `/start` recién después de la línea de log que lo pide (espera interactiva limitada por
  `BRIDGE_DISCOVER_WAIT_SECONDS`).
- **El descubrimiento requiere el `accessToken` en texto plano** que devuelve
  `GET /api/channels/accounts?channel=telegram`; si la cuenta se creó con token placeholder, el
  descubrimiento se omite y hay que fijar `TELEGRAM_CHAT_ID` manualmente.
- **El canal HTTP es solo de entrada.** No hay respuesta por HTTP: la vía de salida es Telegram
  por diseño.
- **Mismatch de `Host` header.** Si el login falla o el ingress responde 404, revisar el banner
  `[env]`: un `MINIKUBE_DOMAIN`/`DEV_DOMAIN` obsoleto en el shell corrompe el `Host` derivado.
  Solución: `unset MINIKUBE_DOMAIN DEV_DOMAIN` o sobrescribir `YOIZEN_HOST_HEADER`.
- **Acceso desde otro dispositivo.** `localhost`/`*.dev.local` solo resuelven en la máquina de
  desarrollo. Para probar desde un teléfono se usa el túnel cloudflared público (mismo que el
  webhook de Telegram) o un `DomainMapping` de Knative sobre `sslip.io` — ver el README en inglés.
