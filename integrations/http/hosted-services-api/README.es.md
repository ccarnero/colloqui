# hosted-services-api — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Registra un **servicio alojado** (Knative) a través de la API de plataforma, crea una **ruta
dinámica** para invocarlo, y conecta un **workflow** que lo llama y notifica por Telegram. El
aprovisionamiento es **declarativo**: un único [`manifest.yaml`](./manifest.yaml) aplicado con la
CLI `yoizen` (sin scripts de setup).

## Qué provisiona el manifest

| Recurso | Qué es |
| --- | --- |
| Servicio (`sample-echo`) | Knative Service, imagen `ealen/echo-server:latest`, `port/minScale/maxScale/concurrencyTarget` (gap 5 — T05) |
| Ruta (`/samples/hosted-echo`) | pública, `GET`/`POST`, `stripPrefix: true` (gap 5 — T05) |
| Canal HTTP dedicado (`hosted-services-api`) | instancia de ingreso propia del workflow |
| Workflow (`hosted-service-telegram`) | `serviceCall` (invoca el servicio, `serviceId` es un `serviceRef` — gap 3, T03) → `jsFunction` (resume la respuesta) → `channelSend` (Telegram) |
| Variable de sistema (`hosted-services-api-chat-id`) | el chat id de Telegram al que se notifica (gap 4 — T04) |

> **Dependencia cruzada.** El `accountId` del paso `notify` es un `channelRef` hacia
> `telegram-transform-reply-bot`, declarado `external: true` — se resuelve por NOMBRE contra el
> estado vivo de la plataforma, nunca se crea desde este manifest. Aplicá primero
> [`telegram-transform-reply/manifest.yaml`](../../channels/telegram-transform-reply/manifest.yaml).

## Nota histórica — variables de entorno (el gap está CERRADO)

El `setup.ts` eliminado declaraba una env var no funcional (`YOIZEN_SAMPLE`) en el servicio. Al
migrar este sample, el schema no podía expresarla y `checkEnvSupport()` del writer del registro
rechazaba cualquier `env` no vacío, así que se descartó en vez de aproximarla.

**Esa restricción ya no existe.** `checkEnvSupport()` fue eliminada; `serviceSchema.env` acepta
`{ name, value }` donde `value` es un string plano, `{ secretRef }`, `{ connectorRef }` o una ref a
un endpoint de connector (`serviceEnvValueSchema` en
`packages/shared/src/provisioning/manifest.schema.ts`), y `buildEnvVars()` de
`registry-services-writer.ts` resuelve cada forma — los strings pasan tal cual y un `secretRef` se
convierte en un `valueFrom.secretKeyRef` nativo de k8s, sin reenviar nunca el VALOR. El sample
hermano `../../ai/ai-call-center-supervisor/manifest.yaml` ya declara
`env: [{ name: YOIZEN_SAMPLE, value: ai-call-center-supervisor }]` en su servicio hosteado.

Este sample sigue omitiendo el marcador: no cambia ningún comportamiento observable, así que no
hay nada que demostrar agregándolo. Si agregás una entrada `env`, el planner la ve — la rama
`kind === "service"` de `build-manifest-plan.ts` proyecta ambos lados con
`serviceEnvMechanismComparable`, que emite una entrada `{ name, mechanism, value? }` por env var:
para un literal plano el lado deseado siempre lleva `value`, mientras que el lado vivo solo lo
replica si el valor en ejecución es idéntico byte a byte, y si no OMITE la clave — así que una
edición de solo-valor difiere y produce un `update` honesto. (Solo las formas realmente
irresolubles —una ref a endpoint, o un `connectorRef` sin id vivo todavía— degradan a una entrada
sin valor, por env var, para que no queden difiriendo para siempre.)

Dos comentarios del repo siguen describiendo el comportamiento VIEJO y se escalan en vez de
editarse (ambos fuera del set editable de esta auditoría): la cabecera del `manifest.yaml` de este
sample, que presenta como vigente la restricción `checkEnvSupport` ya levantada — escalación
**E20** — y el bloque "COMPARABLE LIMITATION" de `registry-services-writer.ts`, que todavía afirma
que las env vars se comparan solo por NOMBRE y que un cambio de solo-valor no produce diff — **E22**.

## El trigger está pineado al canal propio del sample

El trigger está pineado a la cuenta HTTP propia de este manifest vía `trigger.config.accountIds:
[{channelRef: hosted-services-api}]` — la sustitución de arreglo `accountIds`
(`ARRAY_SUBSTITUTION_ALLOWLIST`). Ningún otro workflow disparado por HTTP dispara con el tráfico de
esta instancia.

## Aprovisionar

```bash
cd sdk && bun link   # una vez; o anteponé `bun run bin/yoizen.ts` a cada llamada

yoizen manifests validate -f ../integrations/http/hosted-services-api/manifest.yaml
yoizen manifests plan     -f ../integrations/http/hosted-services-api/manifest.yaml
yoizen manifests apply    -f ../integrations/http/hosted-services-api/manifest.yaml --secrets-from-env
```

Un segundo `apply` es no-op una vez convergido. Este manifest no declara `secrets:` (ningún campo
carga credenciales).

## Configurar el destinatario de Telegram

El chat id vive en `spec.systemVariables[0].value`, no en una env var — editalo en `manifest.yaml`
con tu chat id numérico real y volvé a aplicar (`plan` muestra un veredicto `update` solo para la
variable de sistema):

```bash
yoizen manifests apply -f ../integrations/http/hosted-services-api/manifest.yaml --secrets-from-env
```

El workflow lo resuelve en TIEMPO DE EJECUCIÓN vía
`{{variables.system.hosted-services-api-chat-id}}` — cambiar el destinatario es un re-apply del
valor de la variable, nunca una edición del workflow (mismo patrón que
`integrations/ai/ai-system-variables`).

## Ejecutar / probar

```bash
cd integrations/http/hosted-services-api
./run.sh
```

`run.sh` (`src/index.ts`) es de solo lectura: verifica que el servicio, la ruta y el workflow
existan, espera la caché de rutas dinámicas del gateway (~15 s), invoca
`/samples/hosted-echo/health` directamente, y — si el workflow y la cuenta HTTP están presentes —
hace un POST de prueba a través del workflow. Los mensajes de Telegram de este sample arrancan con:

```text
HOSTED SERVICE SAMPLE
```

Ese marcador distingue sus mensajes de los de `http-fanout-telegram`, aunque ambos le escriban al
mismo chat.

## Entorno (solo overrides de `run.sh` — el aprovisionamiento lo maneja el manifest)

| Var | Default | Notas |
| --- | --- | --- |
| `HOSTED_SERVICE_NAME` | `sample-echo` | Debe coincidir con el nombre del servicio en `manifest.yaml` si se sobreescribe |
| `HOSTED_ROUTE_PREFIX` | `/samples/hosted-echo` | Debe coincidir con el `pathPrefix` de la ruta en `manifest.yaml` |
| `HOSTED_ROUTE_CACHE_WAIT_SECONDS` | `16` | Espera de refresco de la caché de rutas dinámicas |
| `HOSTED_WORKFLOW_NAME` | `hosted-service-telegram` | Debe coincidir con el nombre del workflow en `manifest.yaml` |
| `HOSTED_HTTP_EXTERNAL_ID` | `manifest:hosted-services-api` | El externalId derivado por el motor de apply (`manifest:<nombre del canal>`) |
| `RUN_TEXT` | `hello hosted service workflow` | Texto del mensaje de prueba |

## Problemas frecuentes

- **El gateway excluye paths propios de la plataforma** del ruteo dinámico — `PLATFORM_PREFIXES`
  en `services/api-gateway/src/hooks/proxy.hook.ts` lista hoy `/api/audit`, `/api/tenants`,
  `/api/registry`, `/api/connectors`, `/api/channels`, `/api/webhooks`, `/api/workflows`,
  `/api/proxy`, `/api/auth`, `/api/dashboard`, `/api/admin`, `/api/runtime` y `/health`. Por eso la
  ruta usa `/samples/hosted-echo`, un prefijo no-plataforma.
- **Las rutas dinámicas se descubren por polling** — el `POLL_INTERVAL_MS` de
  `DynamicRouteCacheService` es de 15 s, de ahí la espera por defecto de 16 s tras el `apply`.
- **`registry-service` hardcodea un readiness probe en `/health` y `runAsUser: 1001`** — tu imagen
  debe soportar ambos, o la ruta puede devolver `502` mientras el Knative Service no está listo.
- **¿Necesitás una env var real en tu propio hosted service?** Declarala — `env: [{ name, value }]`
  con string plano, o `{ secretRef }` para una credencial (ver § Nota histórica); el ejemplo
  trabajado es `../../ai/ai-call-center-supervisor/manifest.yaml`.
