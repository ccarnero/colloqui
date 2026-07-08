# mcp-connections — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de ejecutar `./setup.sh`, la plataforma queda con **un MCP server** con auth tipada
(`authType: "bearer"`), un **agente demo** con habilitación por-tool sobre ese servidor
(`enabled_mcp_tools` + un override de descripción), y un **workflow mínimo** con un paso
`mcpCall` que referencia ese mismo servidor y una tool. La URL del MCP server es **falsa a
propósito** (`https://mcp.example.com/mcp` por defecto): el objetivo del sample es demostrar la
forma exacta de cada llamada del SDK (`create`, `testConnection`, `listTools`,
`updateEnabledMcpTools`, `updateToolDescriptionOverrides`, y la acción `mcpCall` de un
workflow), no integrar un MCP server real. Es la contraparte MCP de `http-connectors` (que hace
lo mismo para adaptadores HTTP de salida).

## Escenario de uso

Un equipo quiere exponerle a un agente un subconjunto de las tools de un MCP server —no todas—,
con una descripción custom para una de ellas, y además invocar esa misma tool desde un workflow
sin pasar por el agente. Antes de este feature, la única perilla que existía era **todo o nada**
por servidor (`enabled_mcp_servers`), y los workflows no tenían ningún nodo para hablarle a un
MCP server. Este sample muestra las tres piezas nuevas juntas: auth + probe + descubrimiento de
tools sobre el servidor, habilitación granular por tool en el agente, e invocación directa desde
un workflow.

Traza de ejemplo (llamadas del SDK, en orden):

```
mcpServers.create({ authType: "bearer", ... })          -> id
mcpServers.testConnection(id)                            -> { success, latencyMs, error? }
mcpServers.listTools(id)                                 -> [] | tool[]
agents.updateEnabledMcpTools(agentId, { enabled_mcp_tools: { "<name>": ["search","lookup"] } })
agents.updateToolDescriptionOverrides(agentId, { tool_description_overrides: { "<name>:search": "..." } })
workflows.create({ actions: [{ activity: "mcpCall", args: { serverId, toolName, params } }] })
```

## Cómo funciona por dentro

### Lo que provisiona setup.sh (vía `@yoizen/platform-sdk`, 6 etapas + recreate opcional)

`setup.sh` solo resuelve el entorno (`../lib/resolve-env.sh`) y ejecuta `src/setup.ts` con
`npx tsx`; toda la lógica vive ahí, usando los recursos `mcpServers`, `agents` y `workflows` del
SDK. El login queda a cargo del cliente del SDK de forma transparente en la primera request, por
eso la numeración de etapas salta directo de `0/6` a `2/6`.

| Etapa | Qué hace |
| --- | --- |
| 0 preflight | Imprime la configuración resuelta (server, agente, tools hardcodeadas) |
| recreate (opcional) | Con `RECREATE=1` borra el MCP server / agente / workflow **de este sample** (por nombre) antes de reprovisionar |
| 2 mcp server | Crea o reutiliza (por nombre) el MCP server con `authType: "bearer"` y `authConfig.token` |
| 3 test connection | Llama `testConnection(id)` — se espera que falle o dé timeout (endpoint falso); se loguea como `[WARN]`, no corta el script |
| 4 discover tools | Llama `listTools(id)` — se espera vacío o error (mismo manejo no-fatal) |
| 5 agente + per-tool | Crea o reutiliza (por nombre) un agente, habilita un subconjunto hardcodeado de tools para ese servidor vía `updateEnabledMcpTools`, y setea un override de descripción vía `updateToolDescriptionOverrides` |
| 6 workflow | Crea o actualiza (full-replace) un workflow con **una** acción `mcpCall` — sin trigger, deliberadamente mínimo |

El script es un **upsert idempotente**: MCP server y agente se resuelven por nombre y se
reutilizan si ya existen; el workflow se actualiza con `PUT` en cada corrida (para reflejar
siempre el `mcpServerId` actual). `RECREATE=1` borra los tres recursos de este sample (por
nombre, no afecta otros samples) antes de recrear desde cero.

### Conceptos de plataforma involucrados

- **Auth tipada en el MCP server.** `authType` acepta `none | api-key | bearer | basic`;
  `authConfig` cambia de forma según el tipo (`{ token }` para bearer, `{ headerName?, key }`
  para api-key, `{ username, password }` para basic) y **no se valida por-forma** en el backend
  (mismo comportamiento que `authConfig` de los connectors HTTP).
- **`testConnection` sin efecto secundario.** Es un probe en vivo (`POST
  admin/mcp-servers/:id/test`, sin body); nunca persiste nada — `is_active` sigue siendo un
  toggle manual, no se deriva del resultado del test.
- **`listTools` es descubrimiento en vivo, no un catálogo declarado.** A diferencia de los
  endpoints de un connector HTTP (que el admin define a mano), las tools de un MCP server salen
  de un `tools/list` real contra el servidor — no hay forma de "agregar" una tool manualmente.
- **`enabled_mcp_tools` se indexa por NOMBRE del servidor, no por id.** Es un
  `Record<serverName, string[] | null>`; `null` para un servidor significa "todas sus tools
  habilitadas" (default compatible con lo que existía antes de este feature).
- **`tool_description_overrides` extiende su formato de clave**, no su tipo: ahora acepta
  también `"<serverName>:<toolName>"` para tools MCP, conviviendo con las claves planas que ya
  usaban las tools de adapter/builtin.
- **Feature flag server-side.** El filtrado por-tool en runtime está detrás de
  `AGENT_MCP_TOOL_FILTERING_ENABLED` (default apagado). La llamada `updateEnabledMcpTools` de
  este sample igual persiste el dato — el flag solo determina si `agent-ai-service` lo *aplica*
  al resolver las tools del agente en runtime.
- **`mcpCall` como acción de workflow.** Mismo nivel que `endpointCall`: `{ serverId, toolName,
  params? }`, tipado por el helper `McpCallAction`, asignable al `WorkflowAction` general del
  SDK (que se mantiene deliberadamente laxo — ver el comment de cabecera de `workflows/types.ts`).

## Qué demuestra técnicamente

- Creación de un MCP server con auth tipada (`authType`/`authConfig`, **camelCase real**, no
  `auth_type`/`auth_config` como asumía un borrador de diseño anterior).
- Probe de conectividad y descubrimiento de tools en vivo, con manejo no-fatal de errores —
  patrón reutilizable para cualquier endpoint que no esté garantizado disponible en todos los
  entornos (mismo estilo que la auto-detección de chats de Telegram en `ai-agent-triage`).
- Habilitación granular por tool en un agente (`enabled_mcp_tools`) + override de descripción
  con clave namespaced (`"<server>:<tool>"`).
- Uso de una acción `mcpCall` en un workflow, vía el helper tipado `McpCallAction`.

Referencias de contrato (verificadas en código): `sdk/src/resources/mcp-servers/client.ts` +
`types.ts`, `sdk/src/resources/agents/client.ts` + `types.ts` (`updateEnabledMcpTools`,
`Agent.enabled_mcp_tools`), `sdk/src/resources/workflows/types.ts` (`McpCallAction`,
`McpCallArgs`), `DOCS/architecture/mcp-connections.md` (§2, §4, §5).

## Cómo ejecutarlo y qué esperar

Prerrequisitos: Node >=18 y una plataforma alcanzable (por defecto el clúster de desarrollo). No
requiere ningún otro sample ni un MCP server real.

```bash
cd sdk/samples/mcp-connections
./setup.sh    # o ./run.sh, que es equivalente (no hay un paso de "call" separado)
```

Resultado esperado en la primera corrida: se crea el MCP server, `testConnection`/`listTools`
loguean `[WARN]` (endpoint falso, esperado), se crea el agente con las tools habilitadas y el
override seteado, y se crea el workflow con la acción `mcpCall`. En una segunda corrida sin
`RECREATE=1`: se reutilizan MCP server y agente por nombre, y el workflow se actualiza
(`PUT`) para reflejar el mismo `serverId`.

## Detalles y advertencias

- **La URL del MCP server es falsa.** Para ver un resultado real de `testConnection`/`listTools`,
  apuntar `MCP_SERVER_URL` a un MCP server real y alcanzable desde dentro del clúster (egress).
- **`enabled_mcp_tools` se indexa por nombre, no por id.** Si renombrás el MCP server después de
  habilitar tools para él, hay que volver a llamar `updateEnabledMcpTools` con el nuevo nombre.
- **El write de `updateEnabledMcpTools` no es lo mismo que su efecto en runtime.** Persiste
  siempre; su aplicación real depende del flag `AGENT_MCP_TOOL_FILTERING_ENABLED`.
- **El workflow nunca se ejecuta.** Este sample no llama `workflows.execute(...)` — el objetivo
  es mostrar la forma de la acción `mcpCall`, no correrla contra un servidor inexistente.
- **Gaps de SDK encontrados al construir este sample** (ver README.md en inglés para el detalle
  completo): `mcp-servers/index.ts` no re-exporta `McpServerTestConnectionResult`, y
  `agents/index.ts` no re-exporta `UpdateEnabledMcpToolsInput` — ninguno de los dos bloquea el
  uso de los métodos correspondientes, pero sí impiden importar esos tipos por nombre desde los
  subpaths públicos del SDK.
- **`RECREATE=1` solo afecta los recursos de este sample** (por nombre exacto), no otros MCP
  servers, agentes o workflows del tenant.
