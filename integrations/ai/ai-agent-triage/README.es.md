# ai-agent-triage — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de aplicar `manifest.yaml`, un mensaje que llega por una **instancia HTTP dedicada** es
clasificado por un **agente de IA publicado** (`agentCall`) en intención / sentimiento / prioridad /
resumen, la respuesta JSON del agente se parsea con un `jsFunction` (solo parseo), y un gateway
`conditional` excluyente envía un resumen por Telegram — 🚨 escalación o ✅ rutina. El provisioning
es **declarativo**: un único [`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen`.

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| Canal | `ai-agent-triage` | Instancia HTTP dedicada (`type: http`, `direction: inbound`) |
| Connector | `sample-openai-llm` | Compartido con `ai-agent-playground`/otros samples de IA |
| Agente | `ai-sample-triage` | `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |
| Variable de sistema | `ai-agent-triage-chat-id` | Destinatario de Telegram — ver § Configurar |
| Workflow | `ai-agent-triage` | `triage` (agentCall) -> `route` (jsFunction) -> `notify` (conditional) |

> **Dependencia cruzada, `external: true`**: el canal de Telegram, propiedad de
> [`telegram-transform-reply`](../../channels/telegram-transform-reply)'s `manifest.yaml`. Aplicalo
> primero.

## Simplificación documentada (un solo destinatario de Telegram)

El `setup.ts` eliminado soportaba un SEGUNDO destinatario descubierto dinámicamente
(`TELEGRAM_CHAT_ID_2`) con un `branch` en paralelo. Una `systemVariables` lleva un solo valor y el
manifest es estático, así que esta migración mantiene **un solo destinatario** — la misma
simplificación que `http-fanout-telegram`/`hosted-services-api` ya establecieron. No es un límite de
capacidad: se podría agregar un segundo destinatario con una segunda systemVariable + un segundo
`channelSend` incondicional si hiciera falta.

## El trigger está pineado al canal propio del sample

El trigger está pineado a la cuenta HTTP propia de este manifest vía `trigger.config.accountIds:
[{channelRef: ai-agent-triage}]` — la sustitución de arreglo `accountIds`
(`ARRAY_SUBSTITUTION_ALLOWLIST`). Ningún otro workflow disparado por HTTP dispara con el tráfico de
esta instancia.

## Secretos (auth bearer del connector LLM)

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `ai-agent-triage-openai-api-key` | `authConfig.bearerToken` | Tu `OPENAI_API_KEY` real |

## Cómo ejecutarlo y qué esperar

Prerrequisitos: `telegram-transform-reply/manifest.yaml` ya aplicado (con un bot token real) y el
bot con `/start` enviado por quien deba recibir el resumen; una API key real de OpenAI; las
variables de entorno habituales.

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-agent-triage/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-agent-triage/manifest.yaml
env "ai-agent-triage-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-agent-triage/manifest.yaml --secrets-from-env
```

## Configurar (destinatario de Telegram)

Editá `spec.systemVariables[0].value` en `manifest.yaml` con tu chat id numérico real, y volvé a
aplicar. El workflow lo lee en RUNTIME vía
`{{variables.system.ai-agent-triage-chat-id}}` — cambiar el destinatario es un re-apply del valor,
nunca una edición del workflow.

```bash
cd integrations/ai/ai-agent-triage
./run.sh
```

`run.sh` (`src/index.ts`) verifica (solo lectura) el workflow y la instancia HTTP dedicada, y
publica tres mensajes de ejemplo (enojado / curioso / feliz). Esperá un DM de Telegram por mensaje.

## Detalles y advertencias

- La respuesta JSON del agente vive en `results.triage.data.reply`; `route` la parsea con fallback
  seguro (no parseable -> prioridad `high`, escala).
