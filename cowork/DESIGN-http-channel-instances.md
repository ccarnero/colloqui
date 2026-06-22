# Diseño — Instancias del canal HTTP (1 instancia ↔ 1 workflow)

> Objetivo: que **cada sample tenga su propia instancia del canal HTTP como punto de entrada**,
> ruteada de forma unívoca a *su* workflow (1:1), sin que un mensaje dispare workflows ajenos.
> Este doc cubre las 5 capas (ingress, resolución, datos, SDK, frontend) y dice qué del frontend
> sirve como está y qué cambiaría.

## TL;DR

- La **instancia ya existe** en el modelo: es la **cuenta de canal** (`externalId` único + `appSecret`).
  Lo que falta NO es el concepto de instancia, sino **atar la instancia al ruteo**.
- Hay **dos caminos**:
  - **Opción A — Convención (cero código):** una cuenta HTTP por sample + `trigger.config.accountIds` + el `channelSelector` del SDK. Disponible **hoy**, determinístico, 1:1. Resuelve por **token**.
  - **Opción B — URL por instancia (first-class):** `/api/webhooks/http/<tenant>/<instancia>`. Es el modelo que vos describís (estilo n8n/Make). Requiere cambios acotados en ingress + resolución + SDK + frontend.
- **Recomendación:** hacer **A ya** (desbloquea los samples sin riesgo) y planificar **B** como el modelo definitivo. Son compatibles: B es "subir de categoría" lo que A hace por convención.

## Vocabulario (clave para no mezclar)

| Término | Qué es | ¿Único? |
| --- | --- | --- |
| **Canal (tipo)** | `http`, `telegram`, `whatsapp` | No — es la categoría |
| **Cuenta / instancia** | Una config concreta del canal: `name` + **`externalId`** + **`appSecret`** | **Sí** (`(channel, external_id)` tiene unique key global) |
| **Connector / adapter** | HTTP *saliente* (lo de `endpointCall`) | Otra cosa — no confundir |

La "instancia del canal HTTP" que querés = **una cuenta de canal HTTP**. Cada una ya nace con un
`externalId` ("Ingest id") y un `appSecret` ("x-http-channel-token"). Falta hacerla *direccionable*.

## Estado actual (verificado en código)

| Capa | Archivo | Comportamiento hoy |
| --- | --- | --- |
| **Ingress (gateway)** | `services/api-gateway/src/modules/channels/webhooks.controller.ts` | `POST /api/webhooks/:channel/:tenantId`. **Sin** segmento de instancia. Público; tenant por path. Publica el body crudo a channel-service por NATS. |
| **Resolución de cuenta** | `services/channel-service/.../webhooks/webhook-ingress.service.ts` (`resolveAccount`) | Para http/telegram el **token** (`x-http-channel-token` = `appSecret`) es **la única señal** que identifica la cuenta. Sin token → `signature_mismatch` (no rutea a la primera). Con varias cuentas, verifica la firma contra cada `appSecret` y elige la que matchea. |
| **Modelo de datos** | `services/channel-service/.../accounts/accounts.dto.ts` | `CreateAccountDto`: `channel`, `provider`, `name`, **`externalId`** (req., único), `appSecret` (auto-gen para http). La instancia ya tiene identidad. |
| **Trigger / ruteo** | `services/workflow-service/.../triggers/trigger-consumer.service.ts` (`filterMatching`) | Matchea por `channels`/`providers` (tipo) + opcional **`accountIds`** + `patterns`. El evento inbound **lleva `payload.accountId`**, así que `accountIds` ya permite atar por instancia. Sin `accountIds` y en `mode:"shared"` → **disparan TODOS** los workflows de ese tipo. |
| **SDK (emisor)** | `sdk/src/infrastructure/{channel-directory,ingest}-adapter.js` | `resolveHttpSecret({ token, tenant, selector:{name?\|externalId?} })` — **ya** puede elegir una cuenta por `externalId`/`name` y usar su `appSecret`. Postea a `/api/webhooks/http/<tenant>` con `x-http-channel-token`. |
| **Frontend — alta** | `services/admin-console/.../channels/account-dialog.component.ts` | El alta HTTP ya pide `externalId` ("Ingest id") y auto-genera `appSecret`. **Crea instancias hoy.** |
| **Frontend — "cómo enviar"** | `services/admin-console/.../channels/channels.component.ts` | Muestra **una sola URL por tenant** (`/webhooks/http/<tenant>`) con `x-http-channel-token: <app-secret>` como placeholder. **No** es por-instancia ni muestra la URL real de cada cuenta. |

**Diagnóstico:** la unicidad por instancia ya está resuelta en el **ingreso** (cada cuenta = token
único). Se rompe en el **ruteo del trigger** (matchea por tipo salvo que fijes `accountIds`) y en la
**experiencia/URL** (una URL compartida + token, no una URL por instancia).

## Opción A — Convención (cero código, disponible hoy)

Da exactamente "cada sample su instancia, 1:1, determinístico" usando lo que ya existe.

1. **Una cuenta HTTP por sample**, con `externalId` = nombre del sample (p.ej. `http-fanout-telegram`),
   cada una con su `appSecret`.
2. **Atar el workflow a esa cuenta**: en el trigger, `config.accountIds = ["<account-id>"]`
   (+ `channels:["http"]`, `providers:["http"]`).
3. **Emisor apunta a esa instancia**: el `http-bridge`/SDK con `channelSelector:{ externalId:"http-fanout-telegram" }`
   (o `YOIZEN_HTTP_CHANNEL_TOKEN=<token de esa cuenta>`).

Resultado: mensaje con el token de la cuenta A → el ingreso resuelve **A** → `filterMatching` deja
pasar **solo** el workflow con `accountIds:[A]`. 1:1, sin tocar código.

- **Pros:** cero cambios de plataforma; se implementa en los `setup.sh` de los samples; reversible.
- **Contras:** la identidad de la instancia es el **token sobre una URL compartida**, no una URL propia;
  el panel "cómo enviar" del frontend sigue mostrando la URL genérica (engañoso); el binding es por
  convención, no obligatorio (alguien puede olvidar `accountIds` y volver a abrir el match).

## Opción B — URL por instancia (modelo first-class)

Tu modelo literal: `http://abc.def/api/webhooks/http/<tenant>/webhook1`, `/webhook2`, … donde el
**path identifica la instancia**. La URL es la identidad y el ruteo; el token queda como segunda
barrera (defensa en profundidad), no como discriminador.

**Superficie de cambio (acotada, capa por capa):**

| Capa | Cambio |
| --- | --- |
| **Ingress** | Agregar segmento opcional: `POST /api/webhooks/http/:tenantId/:instance` en `webhooks.controller`. Pasar `instance` en el envelope publicado a channel-service. |
| **Resolución** | En `resolveAccount`: si viene `instance`, resolver por `(channel, tenant, externalId = instance)` (lookup directo, O(1)) **y** verificar el `appSecret` igual (no confiar solo en la URL). Si no viene, comportamiento viejo (por token). |
| **SDK** | `ingest-adapter`: postear a `/api/webhooks/http/<tenant>/<externalId>` cuando hay instancia configurada. El `selector` ya resuelve `externalId`. |
| **Frontend (alta)** | `account-dialog`: tras crear, **mostrar la URL resultante** (`…/webhooks/http/<tenant>/<externalId>`). Cambio menor. |
| **Frontend ("cómo enviar")** | `channels.component`: pasar de **un snippet genérico por tenant** a **un snippet por cuenta**, con su URL real + su token. Este es el cambio de frontend de verdad. |
| **Trigger** | Igual (`accountIds`) — pero como la URL ya fija la cuenta, el binding 1:1 es natural; opcionalmente, inferir el workflow desde la cuenta. |

- **Pros:** modelo intuitivo (cada conexión = su endpoint), DX clara, ruteo inequívoco sin tokens
  adivinados, alineado con n8n/Make; el problema del trigger "se disuelve".
- **Contras:** toca 4 capas (aunque poco en cada una) + tests; hay que mantener compat con el path viejo.

**Compatibilidad / migración:** mantener `/api/webhooks/http/<tenant>` (por token) funcionando; el path
con `:instance` es aditivo. Las cuentas existentes ya tienen `externalId`, así que su URL nueva sale
"gratis". Nada que migrar en datos.

**Seguridad:** una URL adivinable no debe ser la credencial. Dos opciones: (a) mantener el token
(`x-http-channel-token`) como obligatorio aún con URL por instancia — recomendado; (b) si se quiere
"solo URL", que el segmento sea un slug no adivinable (p.ej. `externalId` + sufijo aleatorio) y rate-limit.

## ¿El frontend sirve como está?

- **Alta de instancias (`account-dialog`): sí.** Ya modela `externalId` + `appSecret`; podés crear N
  cuentas HTTP hoy. (En Opción B: cambio menor para mostrar la URL resultante.)
- **Panel "cómo enviar" (`channels.component`): es el punto flojo.** Hoy muestra **una URL por tenant**
  con `<app-secret>` de placeholder — no refleja instancias. 
  - Para **Opción A** "funciona" pero es engañoso (sugiere un único ingreso). Mejora recomendada:
    mostrarlo **por cuenta**, con el token real de cada una.
  - Para **Opción B** **hay que** cambiarlo: una tarjeta por instancia con su **URL propia** + token.
- **Resto (lista de canales, nav): sirve** sin cambios.

## Aplicación a los samples (el objetivo)

Cada sample arranca con su propia instancia HTTP, 1:1 a su workflow:

| Sample | Instancia (`externalId`) | Workflow | Binding |
| --- | --- | --- | --- |
| `http-bridge` | `http-bridge` | `http-bridge-append-received` | `accountIds:[<id>]` |
| `http-fanout-telegram` | `http-fanout-telegram` | `http-fanout-telegram` | `accountIds:[<id>]` |

- **Con Opción A:** cada `setup.sh` (a) crea/asegura su cuenta HTTP por `externalId`, (b) crea el
  workflow con `trigger.config.accountIds=[esa cuenta]`, (c) documenta enviar con el token de esa
  cuenta (o `channelSelector.externalId`). Listo, sin tocar plataforma.
- **Con Opción B:** además, cada sample expone su **URL propia** `/api/webhooks/http/<tenant>/<externalId>`
  y el README muestra esa URL.

## Recomendación + plan por fases

1. **Fase 1 (ya, sin riesgo):** Opción A en los `setup.sh` de los samples — cuenta por sample +
   `accountIds` + selector. Esto te da el 1:1 determinístico que pediste hoy.
2. **Fase 2 (first-class):** Opción B — ruta `:instance` + resolución por `externalId` + SDK + el panel
   "cómo enviar" por instancia. Es lo que vuelve "real" el modelo de instancias direccionables.
3. **Fase 3 (opcional):** binding 1:1 explícito (la cuenta "posee" su workflow) para no depender de
   `accountIds` por convención.

## Estado de implementación (Opción B — implementada)

Decisiones tomadas: segmento = **`externalId`** (sin migración), **token obligatorio** (defensa en
profundidad), ruta **aditiva** (el path viejo `/webhooks/http/<tenant>` sigue válido).

| Capa | Archivos | Cambio |
| --- | --- | --- |
| shared | `packages/shared/src/webhook.interfaces.ts` | `IWebhookIngressData.instance?` |
| gateway | `webhooks.controller.ts`, `webhook-ingress-publisher.service.ts` | ruta `POST /webhooks/:channel/:tenantId/:instance`; `instance` viaja en el envelope |
| channel-service | `webhook-ingress-consumer.service.ts`, `webhook-ingress.service.ts` | `processEnvelope(..., instance?)`; `resolveAccount` acota por `externalId` y verifica token; instancia desconocida → `unknown_instance` |
| channel-service (tests) | `test/unit/webhook-ingress.service.spec.ts` | +2 casos (rutea a la cuenta correcta aun con ambos tokens válidos; instancia inexistente rechazada) |
| SDK | `ports.js`, `config.js`, `channel-directory-adapter.js`, `ingest-adapter.js`, `ingest-client.js` | postea a `/api/webhooks/http/<tenant>/<externalId>` cuando hay instancia; `YOIZEN_HTTP_CHANNEL_INSTANCE` / `channelSelector.externalId` / externalId resuelto |
| frontend | `channels/channels.component.ts` | panel "cómo enviar" **por cuenta**, con su URL real por instancia |
| samples | `http-fanout-telegram/setup.sh`, `README.md` | crea su **instancia HTTP dedicada** (`externalId=http-fanout-telegram`) y **pinea el trigger** (`accountIds`); imprime su URL + token |

**Verificación hecha aquí:** `tsc --noEmit` limpio en **api-gateway** y **channel-service** (0 errores,
specs incluidos); **SDK 5/5** unit (construcción de URL + hilado de `instance`); `bash -n` + render JSON
del sample con `accountIds`. **Pendiente (necesita tu toolchain):** `bun test` (spec channel-service +
unit del SDK), `ng build` / `ng test` (admin-console), y el redeploy:
`./rebuild-redeploy.sh api-gateway && ./rebuild-redeploy.sh channel-service && ./rebuild-redeploy.sh admin-console`.

**Compatibilidad:** el path viejo y el ruteo por token quedan intactos; todo lo nuevo es opt-in
(URL con `:instance` / `accountIds` / `YOIZEN_HTTP_CHANNEL_INSTANCE`).

## Decisiones abiertas

- ¿Segmento de URL = `externalId` (ya único) o un **slug elegible** (`webhook1`)? (Sugerencia: `externalId`,
  y dejar que el `name` sea el legible.)
- ¿Mantener token obligatorio en Opción B (recomendado) o ir a "solo URL" con slug no adivinable?
- ¿Empezamos por Fase 1 sobre los dos samples actuales, o saltamos directo a B?
