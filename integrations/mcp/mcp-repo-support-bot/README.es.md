# mcp-repo-support-bot — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción:
> explica qué hace el sample, cómo funciona por dentro y qué esperar al
> ejecutarlo.

## ¿Qué hace este sample?

Es una demostración **de punta a punta** de la acción de workflow `mcpCall`
(`DOCS/architecture/mcp-connections.md` §5): un "Repo Support Bot" de Telegram
que responde preguntas sobre un repositorio de GitHub llamando al servidor MCP
público [DeepWiki](https://mcp.deepwiki.com/mcp) **desde dentro de un
workflow**. El aprovisionamiento es **declarativo**: un único
[`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen` (sin scripts
de setup).

Mientras que [`mcp-connections`](../mcp-connections) muestra las *formas de
las llamadas del SDK* contra un endpoint falso, este sample conecta un
servidor MCP **real** dentro de un workflow **real** de varios pasos,
combinando el patrón de canal Telegram de
[`telegram-transform-reply`](../../channels/telegram-transform-reply) con el
patrón de agente de triage de [`ai-agent-triage`](../../ai/ai-agent-triage).

## Escenario de uso

```
Mensaje entrante de Telegram (el usuario pregunta algo)
  → [agentCall  triage]     clasifica: ¿es sobre el repo, o no?
  → [jsFunction route]      parsea el veredicto JSON estricto del agente
  → [conditional respond]
      ├─ sobre el repo → [mcpCall     askDeepwiki]  DeepWiki ask_question(repoName, question)
      │                   [jsFunction  extract]      aplana el resultado a texto plano
      │                   [agentCall   summarize]    reescribe la respuesta técnica, breve y amable
      │                   [channelSend reply]        responde por Telegram (mismo chat)
      └─ cualquier otra → [channelSend decline]      "solo respondo sobre el repo X"
```

## Decisión de `kind` (`kind: IntegrationManifest`)

A diferencia de `mcp-connections`/`ai-agent-playground` (ambos
`LibraryManifest` sin canal), este manifest declara una cuenta de canal
Telegram entrante **y** un proceso (dos agentes + un workflow) — tanto
`checkAtLeastOneInboundChannel` como `checkAtLeastOneProcess`
(`validate-structural-rules.ts`) se cumplen sin ninguna dispensa, así que es
un `IntegrationManifest` común (el `kind` por defecto de manifest v1).

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| MCP server | `deepwiki` | `transport_type: http`, `authType: "none"` (`auth` omitido), `https://mcp.deepwiki.com/mcp` (público, sin auth) |
| Connector LLM | `sample-openai-llm` | `authType: bearer` vía `secretRef`, `tags: [llm]`; **mismo nombre** que `ai-agent-triage`/`ai-agent-playground` — reconcilia el MISMO connector vivo al aplicarse en el mismo tenant |
| Agente | `repo-support-triage` | Clasificador; responde JSON estricto `{"about_repo": true\|false}`; `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |
| Agente | `repo-support-summarizer` | Reescribe la respuesta técnica de DeepWiki para el usuario final; mismo connector |
| Canal | `mcp-repo-support-bot` (telegram) | RECEIVE vía el secreto de webhook auto-generado, SEND vía el token de bot vinculado |
| Workflow | `mcp-repo-support-bot` | La cadena de acciones de arriba; `agentId`/`serverId` son refs simbólicas `{ agentRef }`/`{ mcpServerRef }` |

Ningún agente está conectado directamente al servidor MCP (sin
`enabledMcpTools`/`toolDescriptionOverrides`, a diferencia del agente demo de
`mcp-connections`) — el workflow llama a DeepWiki **directamente** vía la
acción `mcpCall`; esto refleja el `setup.ts` eliminado tal cual (nunca llamaba
`updateEnabledMcpTools` para este sample).

## La cadena de acciones exacta (tal como está implementada)

El workflow de nivel superior son tres acciones: `triage` (agentCall) →
`route` (jsFunction) → `respond` (conditional). La rama que matchea del
conditional ejecuta sus acciones anidadas **en secuencia sobre el mismo
contexto de ejecución**, así cada acción puede referenciar el resultado de la
anterior con `{{results.<name>...}}` (verificado en `workflow-service`,
`temporal/workflows.ts`).

Se usan dos puentes `jsFunction`, ambos deliberados (no son adorno):

- **`route`** — la `variable` de un conditional es un dot-path sobre objetos;
  **no puede parsear un string JSON**. Por eso `route` parsea la respuesta
  del agente de triage (`{"about_repo": …}` en
  `results.triage.data.reply`) a un booleano real en
  `results.route.about_repo`. Mismo rol de puente que en `ai-agent-triage`. A
  prueba de fallos: un veredicto no parseable se trata como "no es sobre el
  repo" (declina) en vez de disparar un `mcpCall` sobre basura.
- **`extract`** — la actividad `mcpCall` guarda `{ toolName, result, isError,
  durationMs }` en `results.askDeepwiki` (ver
  `connector-runtime/src/activities/mcp-call.activity.ts`). `result` es el
  `content` MCP de la tool **tal cual**, que para una tool de texto puede ser
  un string o un array de bloques `{ type: "text", text }` según la versión
  de `@ai-sdk/mcp`. `extract` normaliza todo eso a un único string `answer`
  que consume el summarizer.

`accountId`/`channel`/`provider`/`to` en las acciones `reply`/`decline` son
templates de RUNTIME (`{{request...}}`) resueltos por `workflow-service` por
request — responder al MISMO chat/cuenta de donde vino el mensaje no necesita
ninguna ref simbólica (mismo patrón que la propia acción `reply` de
`telegram-transform-reply`).

## Secretos

Los nombres de binding son con guiones (manifest v1 no tiene transformación de
nombre — decisión 7); un `.env` cargado por `source` no puede tener
identificadores con guiones directamente, así que `env.example` documenta
variables de nombre simple (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`) y el
comando de apply de abajo las remapea a los nombres de binding exactos vía
`env "<binding-name>=$VALUE"`.

| Nombre de binding (`--secrets-from-env`) | Destino | Valor |
| --- | --- | --- |
| `mcp-repo-support-bot-openai-api-key` | `authConfig.bearerToken` del connector | Tu `OPENAI_API_KEY` real — ambos agentes necesitan un LLM funcional |
| `mcp-repo-support-bot-telegram-token` | `accessToken` del canal (token de bot) | Tu `TELEGRAM_BOT_TOKEN` real para entrega saliente; CUALQUIER valor no vacío provisiona con éxito |

## Cómo ejecutarlo y qué esperar

```bash
cd integrations/mcp/mcp-repo-support-bot
cp env.example .env      # env.example NO tiene punto inicial; setear OPENAI_API_KEY
./run.sh
```

`run.sh` (`src/index.ts`):

1. Confirma que existan el servidor MCP de DeepWiki, ambos agentes y el
   workflow.
2. Prueba, sin garantías, el servidor MCP con `testConnection()`/
   `listTools()` — DeepWiki es real y público, así que se espera que
   funcionen; los fallos se registran como advertencia, nunca como error
   duro.
3. Por defecto (`SIMULATE_INBOUND=1`) postea un update entrante sintético y
   firmado al endpoint de ingesta del webhook y hace polling hasta ver la
   ejecución del workflow. **Observar la ejecución prueba que toda la cadena
   (incluido el `mcpCall` real a DeepWiki) se disparó** — no requiere que
   Telegram entregue la respuesta saliente, y por eso el sample **corre sin
   un bot real**.

Este driver nunca crea ni modifica objetos de la plataforma — aplicá
`manifest.yaml` primero.

### Simular requiere el secreto del webhook

El `appSecret` del webhook de la cuenta **no** lo expone `manifests apply`
(es interno de channel-service). Obtenelo una vez vía `GET
/channels/accounts` (o `client.channels.listAccounts()` del SDK) después de
aplicar, y seteá `TELEGRAM_WEBHOOK_SECRET` en `.env`. Seteá
`SIMULATE_INBOUND=0` para saltear la simulación y solo verificar que los
recursos existan.

## Desvío del trigger

El `setup.ts` eliminado tenía `TG_PIN=1` por defecto, que fijaba el trigger a
la cuenta creada vía `config.accountIds` — plural, y no está en
`SUBSTITUTION_ALLOWLIST`. Manifest v1 no puede expresar ese pin (no existe un
id de manifest-time para embeber). El trigger en `manifest.yaml` queda sin
fijar: se dispara con **cualquier** mensaje de Telegram del tenant
(equivalente en la práctica en un tenant con una sola cuenta de Telegram); ver
Troubleshooting en el README en inglés si corrés esto junto a otros samples
de Telegram sin fijar. Refleja el mismo desvío documentado por
`ai-agent-triage` y `telegram-transform-reply`.

## Por qué se necesita un servidor MCP público

La actividad `mcpCall` aplica un **guard SSRF** antes de conectar (portado del
executor de adapters — ver `mcp-call.activity.ts` `validateUrl`): rechaza
esquemas que no sean `http(s)`, `localhost`, metadata de nube
(`169.254.169.254`), link-local y RFC1918 (`10/8`, `172.16/12`,
`192.168/16`). Un servidor MCP local quedará bloqueado — hace falta un
endpoint público como DeepWiki.

## Feature flags

La acción `mcpCall` **no** necesita ningún feature flag: corre en
`connector-runtime`, independiente de la resolución de tools del lado del
agente. En particular, `AGENT_MCP_TOOL_FILTERING_ENABLED` gatea el filtrado
por-tool solo del lado del **agente** (`agent-ai-service`) y **no** hace falta
acá (ningún agente usa `enabledMcpTools`). Ambos agentes sí necesitan un
connector LLM funcional.
