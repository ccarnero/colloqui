# http-fanout-telegram — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Ante cualquier mensaje que llega por el **canal HTTP**, dispara un workflow que llama **tres APIs
externas en paralelo** (JSONPlaceholder, PokéAPI, Cat Facts), une las tres respuestas en un
resumen, POSTea el resultado combinado a httpbin, y envía el resumen como mensaje directo de
Telegram. Es el sample que "cose" a los otros dos: usa los connectors de `http-connectors` y la
cuenta Telegram de `telegram-transform-reply`. El aprovisionamiento es **declarativo**: un único
[`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen` (sin scripts de setup).

## Qué provisiona el manifest

| Recurso | Qué es |
| --- | --- |
| Canal HTTP dedicado (`http-fanout-telegram`) | instancia de ingreso propia del workflow |
| Workflow (`http-fanout-telegram`) | `branch` (3 `endpointCall` en paralelo) → `join` (`jsFunction`) → `postToHttpbin` (`endpointCall`) → `notify` (`channelSend`) |
| Variable de sistema (`http-fanout-telegram-chat-id`) | el chat id de Telegram al que se notifica (gap 4 — T04) |

Los `adapterId` (gap 3, `connectorRef`) y el `accountId` (`channelRef`) que el `setup.ts` eliminado
resolvía a ids reales al provisionar ahora son refs simbólicas, sustituidas por el motor de apply
en tiempo de aplicación — nunca llegan a workflow-service tal cual.

> **Dependencias cruzadas, ambas `external: true`** (se resuelven por NOMBRE contra el estado vivo
> de la plataforma, nunca se crean desde este manifest):
> - Los 4 connectors — pertenecen a [`http-connectors`](../../http/http-connectors), que sigue en
>   **STAND-BY** (su propia migración está escalada — ver su `STANDBY.md`: la regla estructural de
>   manifest v1 de >=1 canal entrante + >=1 proceso hace imposible expresar un manifest de solo
>   connectors, sin canal ni workflow propios). Corré primero
>   `(cd ../../http/http-connectors && ./setup.sh)` — sigue siendo imperativo.
> - La cuenta Telegram — pertenece al `manifest.yaml` de
>   [`telegram-transform-reply`](../telegram-transform-reply). Aplicalo primero.

## Desviación documentada — trigger sin pin

El script eliminado fijaba (pin) el trigger a su propia instancia HTTP vía `config.accountIds`
(`FANOUT_PIN=1` por defecto). La sustitución de refs simbólicas de manifest v1 solo cubre la clave
SINGULAR `accountId` dentro de los argumentos de una acción, no el arreglo PLURAL
`trigger.config.accountIds` — la misma limitación que ya documenta el manifest de
`telegram-transform-reply`. Este workflow dispara con **cualquier** mensaje HTTP del tenant; si
además corrés [`hosted-services-api`](../../http/hosted-services-api) (también sin pin tras su
propia migración), ambos van a disparar con el mismo mensaje.

## Aprovisionar

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/channels/http-fanout-telegram/manifest.yaml
yoizen manifests plan     -f ../integrations/channels/http-fanout-telegram/manifest.yaml
yoizen manifests apply    -f ../integrations/channels/http-fanout-telegram/manifest.yaml --secrets-from-env
```

Este manifest no declara `secrets:` (ningún campo carga credenciales).

## Configurar el destinatario de Telegram

El chat id vive en `spec.systemVariables[0].value` — editalo en `manifest.yaml` y volvé a aplicar;
el workflow lo resuelve en tiempo de ejecución vía
`{{variables.system.http-fanout-telegram-chat-id}}`.

## Ejecutar / probar

```bash
cd integrations/channels/http-fanout-telegram
./run.sh
```

`run.sh` verifica (solo lectura) que exista una cuenta Telegram activa y el workflow, y hace un
POST de prueba a la URL de ingesta propia de este sample
(`/api/webhooks/http/<tenant>/manifest:http-fanout-telegram`). Sigue invocando
`../../http/http-connectors/setup.sh` primero (ese sample sigue siendo imperativo).

## Detalles y advertencias

- **El templating `{{…}}` fuerza a string.** El `join` entrega **strings** — un `summary` legible
  y un `combinedJson` (JSON serializado) — porque el resolutor aplica `String(value)` a cada hoja.
- **Los nombres de las acciones del branch importan.** El `join` lee `results.getPost`,
  `results.getPokemon`, `results.getCatFact`.
- **Las actividades `endpointCall` corren en `connector-runtime`**, un servicio separado con su
  propia task queue de Temporal — no in-process en `workflow-orchestrator`.
- **El canal HTTP es solo de entrada** — la respuesta va por Telegram por diseño.
- **Cruce con `hosted-services-api`** — ver § Desviación documentada arriba.
