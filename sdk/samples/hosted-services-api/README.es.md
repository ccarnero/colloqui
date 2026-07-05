# hosted-services-api — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de ejecutar `./setup.sh`, la plataforma queda con un **hosted service** propio del tenant:
un servicio registrado llamado `sample-echo` (imagen `ealen/echo-server` por defecto) desplegado
como **Knative Service** en el namespace del tenant, más una **ruta dinámica** en
`/samples/hosted-echo` que el api-gateway proxya hacia él. Opcionalmente (si hay
`TELEGRAM_CHAT_ID`) crea también un workflow `hosted-service-telegram` con su propia instancia de
canal HTTP (`externalId = hosted-services-api`). El comportamiento observable: un `GET` a
`/samples/hosted-echo/health` a través del gateway responde desde el contenedor del tenant, y un
POST a la URL de ingesta del workflow hace que la plataforma invoque el hosted service vía
`serviceCall` y envíe el resultado por Telegram con el prefijo `HOSTED SERVICE SAMPLE`.

## Escenario de uso

Un tenant necesita lógica propia que la plataforma no trae — un motor de reglas, un scorer, una
integración privada — y quiere desplegarla **dentro** de la plataforma en lugar de operar
infraestructura aparte: registrar la imagen, obtener una URL detrás del gateway (con resolución de
tenant y, si se quiere, auth) y poder invocarla desde workflows como un paso más. Este sample
recorre exactamente ese circuito con un echo-server como microservicio de ejemplo: registro,
despliegue Knative con scale-to-zero, ruta dinámica pública y consumo desde un workflow.

Traza de ejemplo:

```
POST {"text":"hello hosted service"}  →  workflow hosted-service-telegram
  → serviceCall POST sample-echo /anything (payload con marker + inbound)
  → summarize (jsFunction) → Telegram:
    "HOSTED SERVICE SAMPLE / Workflow: hosted-service-telegram / Inbound: hello hosted service /
     Hosted service: sample-echo / Status: 200 / Echo path: /anything / Echo body: {...}"
```

## Cómo funciona por dentro

### Lo que provisiona setup.sh (5 etapas + preflight)

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Verifica `jq`/`curl`, valida nombre DNS y prefijo de ruta; sin `TELEGRAM_CHAT_ID` desactiva la parte de workflow con un warning |
| 1 login | `POST /api/auth/login` con el usuario semilla del tenant; obtiene el bearer token |
| 2 service | `POST /api/registry/services` (o `PATCH` si existe por nombre) — registry-service crea/actualiza el Knative Service con `minScale=0`, `maxScale=2`, `concurrencyTarget=25` |
| 3 route | `POST /api/registry/services/:id/routes` — ruta `pathPrefix=/samples/hosted-echo`, pública, con `stripPrefix`; borra rutas obsoletas del mismo prefijo |
| 4 workflow | (opcional) resuelve la cuenta Telegram, crea/reutiliza la instancia HTTP dedicada y crea/actualiza el workflow `serviceCall` → `jsFunction` → `channelSend` |
| 5 summary | Imprime ids, URL de invocación, URL de ingesta y los `curl` de prueba |

Idempotente: el servicio se reutiliza por nombre (y se `PATCH`ean sus ajustes de runtime), la ruta
se reutiliza si coincide en prefijo/métodos/flags, y el workflow existente se actualiza vía
`PATCH`. `RECREATE=1` borra y recrea servicio, instancia HTTP y workflow.

### Anatomía del workflow (opcional)

```
HTTP msg ─► trigger (message_received, channels:["http"], accountIds:[<instancia hosted-services-api>])
              │
              ▼
            invokeHosted  serviceCall — serviceId (UUID) + serviceSlug "sample-echo",
              │           POST /anything, data = { marker, workflowName, inbound: {{request.text}}, ... }
              ▼
            summarize     jsFunction — lee ctx.results.invokeHosted.{status,data},
              │           arma el texto multilinea con el prefijo "HOSTED SERVICE SAMPLE"
              ▼
            notify        channelSend telegram → TELEGRAM_CHAT_ID
                          text = {{results.summarize.text}}
```

Conceptos de plataforma involucrados:

- **Registro Knative vía registry-service.** `POST /api/registry/services` no solo guarda
  metadata: registry-service materializa un Knative Service real en el namespace del tenant, con
  probe de readiness en `/health` y contexto de seguridad no-root (`runAsUser: 1001`)
  hardcodeados hoy.
- **Rutas dinámicas del gateway.** El hook de proxy del api-gateway descubre las rutas por una
  caché con polling (~15 s) y proxya los paths no-plataforma hacia
  `<knativeName>.<namespace>.svc.cluster.local`. Con `isPublic=true` la invocación solo necesita
  los headers de resolución de tenant; con `false` exige bearer auth. `stripPrefix=true` quita
  `/samples/hosted-echo` antes de reenviar.
- **`serviceCall` con `serviceId` UUID.** El workflow referencia el hosted service por el UUID que
  devolvió el registro (más el `serviceSlug` legible); es el análogo interno de `endpointCall`
  para servicios propios del tenant, sin pasar por connectors externos.
- **Instancia HTTP dedicada + trigger pinning.** Con `HOSTED_WORKFLOW_PIN=1` (defecto), el
  trigger queda fijado por `accountIds` a la instancia `hosted-services-api`, de modo que este
  workflow no se cruza con `http-fanout-telegram` aunque ambos escuchen el canal HTTP.
- **Coerción String() del templating.** `summarize` entrega un único string (`text`) que `notify`
  consume vía `{{results.summarize.text}}` — no se pasan objetos anidados.

### Flujo de invocación de punta a punta

Invocación directa: `GET /samples/hosted-echo/health` → api-gateway (hook de rutas dinámicas) →
Knative Service `sample-echo` (activándose desde cero si estaba en escala 0) → respuesta del
contenedor.

Vía workflow: POST a `/api/webhooks/http/<tenant>/hosted-services-api` → NATS JetStream
(`INGRESS-ACME`) → channel-service-worker → workflow-service → Temporal (`runWorkflow`) →
`serviceCall` al Knative Service → `jsFunction` in-process → `channelSend` por NATS →
channel-service-worker (egreso) → `https://api.telegram.org/bot<token>/sendMessage`.

## Qué demuestra técnicamente

- Ciclo completo de hosted services: registro, despliegue Knative con autoscaling
  (`minScale`/`maxScale`/`concurrencyTarget`), ruta dinámica y borrado/actualización idempotentes.
- Exposición selectiva por el gateway: rutas públicas vs. autenticadas, `stripPrefix`, exclusión
  de prefijos reservados de plataforma.
- Consumo del servicio desde un workflow con `serviceCall` (serviceId UUID + serviceSlug).
- Convivencia de varios workflows HTTP en un tenant gracias al pinning por instancia.

Referencias de contrato (verificadas en código): `services/api-gateway/src/modules/registry/registry.controller.ts`
(`/api/registry/services`, `/api/registry/services/:id/routes`),
`services/registry-service/src/modules/services/services.service.ts` (creación/actualización del
Knative Service), `services/registry-service/src/modules/routes/routes.service.ts` (rutas
`pathPrefix` y discovery), `services/api-gateway/src/hooks/proxy.hook.ts` (proxy dinámico hacia
`<knativeName>.<namespace>.svc.cluster.local`).

## Cómo ejecutarlo y qué esperar

Prerrequisitos: `jq`, `curl`, clúster dev alcanzable. Para la parte de Telegram: una cuenta
Telegram activa (`(cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)`) y el
`chat_id` numérico con `/start` ya enviado al bot.

```bash
cd sdk/samples/hosted-services-api
cp .env.example .env    # TELEGRAM_CHAT_ID=... para habilitar el workflow
./setup.sh              # registra servicio + ruta (+ workflow), imprime URLs
./run.sh                # verifica todo, espera la caché de rutas y dispara las pruebas
```

Resultado esperado: `run.sh` espera ~16 s (caché de rutas del gateway), llama
`/samples/hosted-echo/health` e imprime la respuesta del echo-server; si el workflow está
configurado, hace el POST de ingesta y segundos después llega el DM de Telegram prefijado con
`HOSTED SERVICE SAMPLE` — ese marcador distingue sus mensajes de los de `http-fanout-telegram`
aunque ambos apunten al mismo chat.

## Detalles y advertencias

- **Cold-start con `minScale=0`.** El Knative Service escala a cero sin tráfico; la primera
  invocación paga el arranque del pod y puede tardar (o devolver `502` si el contenedor aún no
  está listo). Subir `HOSTED_MIN_SCALE` elimina el cold-start a costa de un pod siempre activo.
- **Caché de rutas dinámicas (~15 s).** El gateway descubre rutas por polling: invocar
  inmediatamente después de crear la ruta da 404; hay que esperar (`run.sh` ya lo hace con
  `HOSTED_ROUTE_CACHE_WAIT_SECONDS`).
- **Prefijos reservados.** El gateway excluye del ruteo dinámico los paths de plataforma
  (`/api/auth`, `/api/registry`, `/api/workflows`, `/api/webhooks`, `/health`); el prefijo de la
  ruta debe ser no-plataforma, como `/samples/hosted-echo`.
- **No fijar `PORT` en `envVars`.** Knative reserva esa variable y la inyecta desde el puerto del
  contenedor; setearla manualmente la rechaza el admission webhook.
- **Requisitos de la imagen.** registry-service hardcodea readiness en `/health` y
  `runAsUser: 1001`; una imagen que no cumpla ambos deja el servicio en not-ready y la ruta
  devolviendo `502`.
- **`channelSend.to` acepta un solo string.** Para notificar a varios chats habría que agregar un
  `branch` con un `channelSend` por rama, como en `http-bridge`.
- **`RECREATE=1`** borra y recrea servicio, instancia HTTP (rotando su `appSecret`) y workflow;
  úsese cuando el estado quedó inconsistente. Las corridas normales actualizan en el lugar
  (`PATCH`), sin rotar tokens.
