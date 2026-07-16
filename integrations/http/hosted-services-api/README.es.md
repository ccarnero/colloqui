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

## Gap documentado — variables de entorno

El `setup.ts` eliminado declaraba una env var no funcional (`YOIZEN_SAMPLE`) en el servicio. El
schema de manifest v1 (`serviceSchema.env`) no tiene campo de valor plano (solo
`{name, secretRef}`), y el writer del registro (`checkEnvSupport()`) rechaza CUALQUIER `env` no
vacío — una restricción previa a este loop que el gap 5 (T05) no levantó pese a tocar la misma
sección para los campos de escalado. Por eso esta env var **se omite** del manifest, no se
aproxima — ver el comentario dedicado en `manifest.yaml` para la cita exacta del código.

## Desviación documentada — trigger sin pin

El script eliminado fijaba (pin) el trigger a su propia instancia HTTP vía
`config.accountIds: [<id>]` (`HOSTED_WORKFLOW_PIN=1` por defecto). La sustitución de refs
simbólicas de manifest v1 solo cubre la clave SINGULAR `accountId` dentro de los argumentos de una
acción (`SUBSTITUTION_ALLOWLIST`), no el arreglo PLURAL `trigger.config.accountIds` — la misma
limitación que ya documenta el manifest de `telegram-transform-reply` para su propio trigger. Este
workflow dispara con **cualquier** mensaje HTTP del tenant; si además corrés
[`http-fanout-telegram`](../../channels/http-fanout-telegram) (también sin pin tras su propia
migración), ambos van a disparar con el mismo mensaje.

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

- **El gateway excluye paths propios de la plataforma** (`/api/auth`, `/api/registry`,
  `/api/workflows`, `/api/webhooks`, `/health`) del ruteo dinámico — por eso la ruta usa
  `/samples/hosted-echo`, un prefijo no-plataforma.
- **Las rutas dinámicas se descubren por polling** — esperá ~15 s tras el `apply` antes de la
  primera invocación.
- **`registry-service` hardcodea un readiness probe en `/health` y `runAsUser: 1001`** — tu imagen
  debe soportar ambos, o la ruta puede devolver `502` mientras el Knative Service no está listo.
- **Cruce con `http-fanout-telegram`.** Los workflows HTTP de ambos samples están sin pin (ver §
  Desviación documentada). Para probar uno aislado, deshabilitá el workflow del otro desde el
  admin-console, o simplemente no apliques ambos manifests en el mismo tenant a la vez.
- **Las env vars no son provisionables** (ver § Gap documentado) — si tu propio hosted service
  NECESITA una env var real, este sample todavía no puede demostrar esa forma; seguí el backlog de
  rulings humanos de `manual-loops/provisioning-manifest-gaps.md`.
