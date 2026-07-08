# mcp-repo-support-bot — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción:
> explica qué hace el sample, cómo funciona por dentro y qué esperar al
> ejecutarlo.

## ¿Qué hace este sample?

Es una demostración **de punta a punta** de la acción de workflow `mcpCall`
(`DOCS/architecture/mcp-connections.md` §5): un "Repo Support Bot" de Telegram
que responde preguntas sobre un repositorio de GitHub llamando al servidor MCP
público [DeepWiki](https://mcp.deepwiki.com/mcp) **desde dentro de un workflow**.

Mientras que [`mcp-connections`](../mcp-connections) muestra las *formas de las
llamadas del SDK* contra un endpoint falso, este sample conecta un servidor MCP
**real** dentro de un workflow **real** de varios pasos, combinando el patrón de
canal Telegram de [`telegram-transform-reply`](../telegram-transform-reply) con
el patrón de agente de triage de [`ai-agent-triage`](../ai-agent-triage).

## Escenario de uso

Un equipo tiene un repositorio en GitHub y quiere un bot de soporte que responda
preguntas sobre su código sin construir ni mantener una base de conocimiento
propia. DeepWiki ya indexa repos públicos y expone una tool `ask_question` vía
MCP. Antes de este feature, un workflow no tenía ningún nodo para hablarle a un
servidor MCP: la única vía era envolver un agente que usara la tool dentro de un
`agentCall`, y el workflow nunca "veía" la tool. Ahora el workflow invoca la tool
directamente con `mcpCall`.

El flujo:

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

## Cómo funciona por dentro

### Lo que provisiona setup.sh (vía `@yoizen/platform-sdk`, 6 etapas + recreate opcional)

`setup.sh` solo resuelve el entorno (`../lib/resolve-env.sh`) y ejecuta
`src/setup.ts` con `npx tsx`; toda la lógica vive ahí. El login queda a cargo del
cliente del SDK de forma transparente en la primera request.

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Valida credenciales de LLM y token de Telegram; imprime la configuración resuelta |
| recreate (opcional) | Con `RECREATE=1` borra workflow / agentes / MCP server **de este sample** (por nombre) antes de reprovisionar |
| 1 mcp server | Crea o reutiliza (por nombre) el MCP server `deepwiki` con `authType: "none"`, transport `http` |
| 2 test + tools | Llama `testConnection(id)` y `listTools(id)` — no-fatal: avisa con `[WARN]` si DeepWiki no responde |
| 3 connector LLM | Crea o reutiliza un connector LLM (salvo `AI_CREDENTIAL_MODE=env`), compartido por ambos agentes |
| 4 agentes | Crea/actualiza y **publica** el agente de triage y el summarizer |
| 5 cuenta Telegram | Crea o reutiliza la cuenta de canal Telegram (dedup por prefijo de `externalId`, cachea el `appSecret` del webhook) |
| 6 workflow | Crea o actualiza (full-replace) el workflow con la cadena de acciones completa |

Después provisiona el webhook de Telegram (si hay `TG_PUBLIC_URL` + token real) y,
si `SIMULATE_INBOUND=1`, dispara un intercambio sintético.

El script es un **upsert idempotente**: MCP server y agentes se resuelven por
nombre y se reutilizan; el workflow se reescribe en cada corrida para reflejar
siempre los ids actuales. `RECREATE=1` borra los recursos de este sample (por
nombre, sin afectar otros samples) y rota la cuenta de Telegram.

### La cadena de acciones exacta

El workflow de nivel superior son tres acciones: `triage` (agentCall) → `route`
(jsFunction) → `respond` (conditional). La rama que matchea del conditional
ejecuta sus acciones anidadas **en secuencia sobre el mismo contexto de
ejecución**, así cada acción puede referenciar el resultado de la anterior con
`{{results.<name>...}}` (verificado en `workflow-service`,
`temporal/workflows.ts`).

Se usan dos puentes `jsFunction`, ambos deliberados (no son adorno):

- **`route`** — la `variable` de un conditional es un dot-path sobre objetos; **no
  puede parsear un string JSON**. Por eso `route` parsea la respuesta del agente
  de triage (`{"about_repo": …}` en `results.triage.data.reply`) a un booleano
  real en `results.route.about_repo`. Mismo rol de puente que en `ai-agent-triage`.
  A prueba de fallos: un veredicto no parseable se trata como "no es sobre el repo"
  (declina) en vez de disparar un `mcpCall` sobre basura.
- **`extract`** — la actividad `mcpCall` guarda `{ toolName, result, isError,
  durationMs }` en `results.askDeepwiki` (ver
  `connector-runtime/src/activities/mcp-call.activity.ts`). `result` es el
  `content` MCP de la tool **tal cual**, que para una tool de texto puede ser un
  string o un array de bloques `{ type: "text", text }` según la versión de
  `@ai-sdk/mcp`. `extract` normaliza todo eso a un único string `answer` que
  consume el summarizer.

El paso `mcpCall` se construye con el tipo fuerte `McpCallAction` vía `satisfies`
(mismo patrón que `mcp-connections`); sus `params` (`repoName` = `REPO_NAME`,
`question` = `{{request.text}}`) son templates `{{...}}` resueltos por
`workflow-service` antes de ejecutar la actividad.

### Conceptos de plataforma involucrados

- **Acción `mcpCall` en workflows.** Ejecuta en `connector-runtime` con una
  conexión MCP **efímera** (conecta, invoca una tool, desconecta), a diferencia
  de las conexiones per-tenant de larga vida de `agent-ai-service`.
- **Guard SSRF.** Antes de conectar, la actividad rechaza esquemas no `http(s)`,
  `localhost`, metadata de nube, link-local y RFC1918. Por eso **se necesita un
  servidor MCP público** como DeepWiki.
- **Gateway conditional.** `respond` evalúa `results.route.about_repo`; el motor
  resuelve el path crudo y compara con `String()`, así que el valor `"true"`
  matchea el booleano `true`.
- **Trigger de canal.** El workflow se dispara con `message_received` sobre
  Telegram, fijado (`accountIds`) a la cuenta creada para no cruzarse con otros
  workflows de Telegram.

## Qué demuestra técnicamente

- `mcpServers.create/testConnection/listTools` contra un servidor MCP **real**.
- Dos agentes publicados (triage estricto-JSON + summarizer) sobre un connector LLM.
- La cuenta de canal Telegram + registro de webhook (reusa la lógica de
  `telegram-transform-reply`, incluida la normalización de `TG_PUBLIC_URL`).
- Un workflow con `agentCall`, `jsFunction`, `conditional` y — la pieza central —
  `mcpCall`, todo encadenado en un escenario coherente.

## Cómo ejecutarlo y qué esperar

```bash
cd sdk/samples/mcp-repo-support-bot
cp env.example .env      # env.example NO tiene punto inicial; setear OPENAI_API_KEY
./run.sh
```

`run.sh` pone `SIMULATE_INBOUND=1` por defecto: postea un update entrante
sintético y firmado al endpoint de ingesta del webhook y hace polling hasta ver
la ejecución del workflow. **Observar la ejecución prueba que toda la cadena
(incluido el `mcpCall` a DeepWiki) se disparó** — no requiere que Telegram
entregue la respuesta saliente, y por eso el sample **corre sin un bot real**.
Con un token placeholder el envío saliente da 404, pero la ejecución igual
completa.

Para entrega real por Telegram: setear `TELEGRAM_BOT_TOKEN` (de @BotFather) y
`TG_PUBLIC_URL` (base HTTPS pública, ej. un túnel de cloudflared), correr una vez
con `RECREATE=1` para rotar la cuenta y registrar el webhook, y después
simplemente **escribirle al bot**.

## Detalles y advertencias

- **`env.example` sin punto inicial.** Una restricción de sandbox del entorno de
  autoría impide escribir archivos `.env.*`; copialo a `.env`.
- **DeepWiki debe ser alcanzable.** El cluster necesita egress a
  `mcp.deepwiki.com`. Si `ask_question` no aparece en las tools descubiertas, el
  paso `mcpCall` fallará en runtime.
- **Ningún feature flag es necesario.** `mcpCall` corre en `connector-runtime`,
  independiente del filtrado de tools por-agente. En particular,
  `AGENT_MCP_TOOL_FILTERING_ENABLED` gatea solo el filtrado del lado del **agente**
  (`agent-ai-service`) y **no** hace falta acá.
- **Los agentes sí necesitan LLM.** Un connector válido (o `AI_CREDENTIAL_MODE=env`
  con la key ya en `agent-ai-service`).
