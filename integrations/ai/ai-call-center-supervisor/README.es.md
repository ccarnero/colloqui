# ai-call-center-supervisor — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

El sample **capstone** — un loop de supervisión de IA que combina un **servicio hosteado** (mock
CRM), un **agente de IA** (`agentCall`), **ruteo condicional** y **escalación por Telegram**. El
provisioning es **declarativo**: un único [`manifest.yaml`](./manifest.yaml) aplicado con la CLI
`yoizen`.

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| Canal | `ai-call-center-supervisor` | Instancia HTTP dedicada |
| Connector | `sample-openai-llm` | Compartido con los otros samples de IA |
| Agente | `ai-sample-supervisor` | `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |
| Servicio hosteado | `sample-crm` | `ealen/echo-server:latest`, `env: [{ name: YOIZEN_SAMPLE, value: ai-call-center-supervisor }]` |
| Variable de sistema | `ai-call-center-supervisor-chat-id` | Destinatario de Telegram — ver § Configurar |
| Workflow | `ai-call-center-supervisor` | `lookupCustomer` -> `buildTriageInput` -> `triage` -> `decide` -> `route` |

> **Dependencia cruzada, `external: true`**: el canal de Telegram, propiedad de
> [`telegram-transform-reply`](../../channels/telegram-transform-reply)'s `manifest.yaml`.

## Desviación documentada (trigger sin pin)

Misma limitación que `ai-agent-triage`/`http-fanout-telegram`: la sustitución de refs simbólicos
solo cubre la clave singular `accountId`, no el array plural `trigger.config.accountIds`. Dispara
ante cualquier mensaje HTTP del tenant.

## Secretos (auth bearer del connector LLM)

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `ai-call-center-supervisor-openai-api-key` | `authConfig.bearerToken` | Tu `OPENAI_API_KEY` real |

## Cómo ejecutarlo y qué esperar

Prerrequisitos: clúster con registry-service + Knative, `telegram-transform-reply` ya aplicado (bot
con `/start`), una API key real de OpenAI.

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-call-center-supervisor/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-call-center-supervisor/manifest.yaml
env "ai-call-center-supervisor-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-call-center-supervisor/manifest.yaml --secrets-from-env
```

## Configurar (destinatario de Telegram)

Editá `spec.systemVariables[0].value` en `manifest.yaml` y volvé a aplicar. Se lee en RUNTIME vía
`{{variables.system.ai-call-center-supervisor-chat-id}}`.

```bash
cd integrations/ai/ai-call-center-supervisor
./run.sh
```

`run.sh` publica un mensaje ENOJADO (esperá 🚨 SUPERVISOR ESCALATION) y uno TRANQUILO (esperá ✅
AUTO-RESOLVED) unos segundos después.

## Detalles y advertencias

- `serviceId` resuelve vía el ref simbólico `serviceRef` en tiempo de apply; el `env` del servicio
  hosteado usa `{ name, value }` — solo strings planos (T05), `YOIZEN_SAMPLE` es un marcador de
  debug, no una credencial.
- **Cold start**: `minScale: 0` puede hacer lento el primer `serviceCall`.
- **Cruce de disparos** con otros samples HTTP sin pin.
