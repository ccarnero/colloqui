# http-fanout-telegram — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de ejecutar `./setup.sh`, la plataforma queda con una **instancia de canal HTTP dedicada**
(cuenta con `externalId = http-fanout-telegram`, con su propia URL de ingesta y su propio
`appSecret`) y un **workflow** llamado `http-fanout-telegram`. El comportamiento observable:
cualquier JSON enviado por POST a la URL de ingesta de esa instancia dispara el workflow, que
llama **tres APIs externas en paralelo** (un post de JSONPlaceholder, un Pokémon de PokéAPI y un
dato de Cat Facts), une las tres respuestas en un resumen, POSTea el resultado combinado a
httpbin y envía el resumen como mensaje directo de Telegram. Es el sample que "cose" a los otros
dos: usa los connectors de `http-connectors` y la cuenta Telegram de `telegram-transform-reply`.

## Escenario de uso

Una petición entrante trae apenas un identificador (un pedido, un cliente, una alerta) y la
respuesta útil requiere **enriquecerla con varias fuentes a la vez**: el CRM, el sistema de
facturación y un servicio de scoring. Hacer esas llamadas en secuencia suma latencias; este patrón
las lanza en paralelo con un `branch`, las une con un paso de código y entrega el resultado
consolidado por el canal que el equipo realmente mira (Telegram), dejando además una copia del
payload combinado en un endpoint HTTP (aquí httpbin como stand-in de un sistema downstream).

Traza de ejemplo:

```
POST {"text":"hola"}  →  workflow http-fanout-telegram
  ├─ GET jsonplaceholder /posts/1        ┐
  ├─ GET pokeapi /api/v2/pokemon/ditto   ├─ en paralelo (branch / Promise.all)
  └─ GET catfacts /fact                  ┘
  → join → POST httpbin /post → Telegram:
    "Mensaje recibido: hola / Post: sunt aut facere… / Pokemon: ditto /
     Dato gatuno: Cats sleep 70% of their lives. (httpbin status: 200)"
```

## Cómo funciona por dentro

### Lo que provisiona setup.sh (3 etapas + preflight)

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Exige `TELEGRAM_CHAT_ID` (falla rápido sin él) |
| 1 login | `POST /api/auth/login` con el usuario semilla del tenant; obtiene el bearer token |
| 2 resolve | Resuelve por nombre los `adapterId` de los 4 connectors, la cuenta Telegram activa (o la fijada por `TG_ACCOUNT_ID`), y crea/reutiliza la instancia HTTP dedicada capturando su `appSecret` |
| 3 workflow | Crea (o reutiliza por nombre) el workflow con el trigger fijado (pinning) a la instancia |

Idempotente: re-ejecutar reutiliza todo por nombre y deduplica instancias y workflows repetidos en
cada corrida. `RECREATE=1` reconstruye la instancia HTTP y el workflow.

### Anatomía del workflow

```
HTTP msg ─► trigger (message_received, channels:["http"], accountIds:[<instancia>])
              │
            fanout          branch (PARALELO — tres ramas)
              ├── getPost       endpointCall  jsonplaceholder  GET /posts/1
              ├── getPokemon    endpointCall  pokeapi          GET /api/v2/pokemon/ditto
              └── getCatFact    endpointCall  catfacts         GET /fact
              ▼
            join            jsFunction — lee ctx.results.{getPost,getPokemon,getCatFact}.data
              │             y retorna { summary, combinedJson } (dos STRINGS)
              ▼
            postToHttpbin   endpointCall POST httpbin /post
              │             body usa {{results.join.summary}} y {{results.join.combinedJson}}
              ▼
            notify          channelSend telegram → TELEGRAM_CHAT_ID
                            text = "{{results.join.summary}}\n(httpbin status: {{results.postToHttpbin.status}})"
```

Conceptos de plataforma involucrados:

- **Instancia de canal HTTP dedicada + trigger pinning.** El workflow solo se dispara con mensajes
  enviados a `/api/webhooks/http/<tenant>/http-fanout-telegram` autenticados con el
  `x-http-channel-token` (el `appSecret` de la instancia). Con `FANOUT_PIN=1` (defecto),
  `trigger.config.accountIds` contiene solo el id de esta instancia — sin interferencia con otros
  workflows HTTP del tenant. `FANOUT_PIN=0` lo abre a cualquier mensaje HTTP.
- **`branch` con paralelismo real.** El ejecutor corre las ramas con `Promise.all`; las tres
  llamadas HTTP salen de forma genuinamente concurrente.
- **Connectors por `adapterId`.** Los ids (por tenant) se resuelven al momento de crear el
  workflow; si falta un connector el script se detiene apuntando a `../http-connectors/setup.sh`.
- **Coerción String() del templating.** El resolutor de `{{...}}` aplica `String(value)` a cada
  hoja: no se pueden pasar objetos anidados. Por eso `join` entrega **strings** — un `summary`
  legible y un `combinedJson` (JSON serializado) — que los pasos siguientes consumen tal cual.

### Flujo de mensaje de punta a punta

| # | Desde | Transporte | Subject / URL | Hacia |
|---|-------|------------|---------------|-------|
| 1 | Cliente HTTP | HTTPS POST + `x-http-channel-token` | `/api/webhooks/http/acme/http-fanout-telegram` | api-gateway |
| 2 | api-gateway | NATS JetStream (`INGRESS-ACME`) | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingreso) | NATS JetStream | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · `runWorkflow` | worker de workflow-service |
| 5 | worker · `branch` (paralelo) | Despacho de tareas Temporal | task queue `connector-runtime` | connector-runtime (×3 concurrentes) |
| 5a–5c | connector-runtime | HTTPS GET | jsonplaceholder / pokeapi / catfact.ninja | APIs públicas |
| 6 | worker · `jsFunction` (join) | local (in-process) | `workflow-orchestrator` | mismo worker |
| 7 | worker · `endpointCall` (postToHttpbin) | Despacho de tareas Temporal | task queue `connector-runtime` | connector-runtime → `POST https://httpbin.org/post` |
| 8 | worker · `channelSend` (notify) | NATS core, capturado por `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 9 | channel-service-worker (egreso) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

A diferencia de `http-bridge`, aquí las actividades `endpointCall` **no** corren in-process: se
despachan a `connector-runtime`, un servicio separado con su propia task queue de Temporal. El
worker `workflow-orchestrator` solo ejecuta `jsFunction` y `channelSend` localmente.

## Qué demuestra técnicamente

- Fan-out paralelo con `branch` (ejecución concurrente real vía `Promise.all`) y join con
  `jsFunction` leyendo `ctx.results.<nombre-de-acción>`.
- Consumo de connectors declarativos por `adapterId` + `url` como path (forma 2 de
  `EndpointCallArgs`).
- Separación de runtimes: `endpointCall` en `connector-runtime`, `jsFunction`/`channelSend` en el
  worker `workflow-orchestrator`.
- Instancia HTTP dedicada con `appSecret` y trigger pinning por `accountIds`.
- Templating `{{...}}` con coerción a string y el patrón "entregar strings, no objetos".

Referencias de contrato (verificadas en código): `services/workflow-service/src/temporal/workflows.ts`
(ejecutor, branch paralelo, templating), `services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts`
(esquema de acciones), `packages/shared/src/workflow.interfaces.ts` (`EndpointCallArgs`),
`services/workflow-service/src/temporal/activities/channel-send.activity.ts` (`channelSend`).

## Cómo ejecutarlo y qué esperar

Prerrequisitos (este script solo cablea el workflow):

1. Connectors `jsonplaceholder`, `pokeapi`, `catfacts`, `httpbin`:
   `(cd ../http-connectors && ./setup.sh)`.
2. Cuenta Telegram con token real: `(cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)`.
3. El `chat_id` numérico propio, con `/start` ya enviado al bot (un bot no puede iniciar
   conversación por número de teléfono).

```bash
cd sdk/samples/http-fanout-telegram
TELEGRAM_CHAT_ID=123456789 ./setup.sh   # o ponerlo en .env
./run.sh                                # provisiona dependencias y hace el POST de prueba
```

Resultado esperado: el POST responde `{"status":"accepted"}` (ejecución asíncrona) y segundos
después llega el DM de Telegram con las cuatro líneas del resumen más `(httpbin status: 200)`.
`setup.sh` imprime al final la URL de ingesta exacta y el token para hacer el POST manual con
`curl`.

## Detalles y advertencias

- **`channelSend.to` acepta un único string.** Este workflow notifica a un solo chat; para varios
  destinatarios habría que construir un `branch` con un `channelSend` por rama (ver `http-bridge`).
- **Los nombres de las acciones del branch importan.** El `join` lee `results.getPost`,
  `results.getPokemon`, `results.getCatFact`; renombrar una acción exige actualizar el código del
  join.
- **`RECREATE=1` rota el token.** Reconstruir la instancia HTTP cambia el `appSecret`; cualquier
  cliente con el token viejo empieza a recibir rechazos.
- **Pin obsoleto (stale pin).** Si la instancia HTTP se recrea sin `RECREATE=1` del workflow, el
  `accountIds` del trigger queda apuntando a un id borrado y el workflow deja de dispararse en
  silencio. Reconstruir ambos juntos evita el problema.
- **El canal HTTP es solo de entrada.** No hay respuesta por HTTP; la vía de salida es Telegram
  por diseño.
- **Obtener el `chat_id`** requiere haber enviado un mensaje al bot y consultarlo vía
  `getUpdates`; si el bot tiene un webhook activo (registrado por `telegram-transform-reply`),
  `getUpdates` devuelve 409 — usar el auto-descubrimiento de `http-bridge` o `@userinfobot`.
