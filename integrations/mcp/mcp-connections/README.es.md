# mcp-connections — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de aplicar `manifest.yaml`, la plataforma queda con **un MCP server** con auth tipada
(`authType: bearer` vía `secretRef`), un **agente demo** con habilitación por-tool sobre ese
servidor (`enabledMcpTools` + un override de descripción), y un **workflow mínimo** con un paso
`mcpCall` que referencia ese mismo servidor y una tool. La URL del MCP server es **falsa a
propósito** (`https://mcp.example.com/mcp`): el objetivo del sample es demostrar la forma exacta
de cada sección del manifest (auth, habilitación por-tool, override de descripción, acción
`mcpCall`), no integrar un MCP server real. Es la contraparte MCP de `http-connectors` (que hace
lo mismo para adaptadores HTTP de salida) y el primer canario MCP realmente migrable de la
plataforma. El provisioning es **declarativo**: un único [`manifest.yaml`](./manifest.yaml)
aplicado con la CLI `yoizen` (sin scripts de setup).

## Decisión de `kind` (`kind: LibraryManifest`)

Este manifest provisiona un `mcpServer` + un `agent` + un `workflow` — existe un PROCESO (agentes/
workflows), pero **no hay ningún canal**. Un `IntegrationManifest` exige incondicionalmente al
menos un canal inbound; `kind: LibraryManifest` exime esa regla (y la de >=1-proceso) y exige en
su lugar al menos un recurso de biblioteca (connector/mcpServer/service/systemVariable),
satisfecho aquí por el `mcpServer`. El ruling de T01 **permite explícitamente** manifests de
biblioteca mixtos (recursos de biblioteca junto con agentes/workflows) — la exención es aditiva,
no una prohibición. Verificado localmente contra `integrationManifestSchema.safeParse` +
`validateManifestStructuralRules` antes de comitear este manifest — ver el comentario de cabecera
del propio `manifest.yaml` y el reporte de esta migración.

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| MCP server | `sample-mcp-server` | `transport_type: http`, `authType: bearer` vía `secretRef`, URL **falsa/de ejemplo** (`https://mcp.example.com/mcp`) |
| Agente | `mcp-connections-demo-agent` | `enabledMcpTools: { sample-mcp-server: [search, lookup] }` + un `toolDescriptionOverrides` (`sample-mcp-server__search` — doble guion bajo, ver abajo) |
| Workflow | `mcp-connections-demo` | Una acción `mcpCall`, `serverId: { mcpServerRef: sample-mcp-server }` — sin trigger, deliberadamente mínimo |

La URL del MCP server es **falsa a propósito** — el objetivo es demostrar las formas del manifest/
SDK (`auth`, `testConnection`, `listTools`, `enabledMcpTools`, `toolDescriptionOverrides`, y la
acción `mcpCall`), no integrar un servidor MCP real. Se espera que `testConnection` y `listTools`
fallen o devuelvan vacío contra este endpoint falso.

## Secretos (auth bearer del MCP server)

El `setup.ts` eliminado leía `MCP_AUTH_TOKEN` con un literal de fallback `"sample-bearer-token"`
cuando no estaba seteado — un placeholder para un endpoint falso, pero igual un valor literal, y
el bloque `auth` de manifest v1 es `secretRef`-only por schema (sin escape hatch de texto plano).
El manifest expresa `authType: bearer` con un `secretRef` anidado (`mcp-connections-bearer-token`)
en su lugar:

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `mcp-connections-bearer-token` | `authConfig.token` | CUALQUIER string no vacío — el endpoint es falso y nunca autentica realmente |

## Cómo ejecutarlo y qué esperar

Prerrequisitos: un clúster de desarrollo corriendo y las variables de entorno habituales
(`YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`, `YOIZEN_PASSWORD`). No
requiere ningún otro sample ni un MCP server real.

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/mcp/mcp-connections/manifest.yaml
yoizen manifests plan     -f ../integrations/mcp/mcp-connections/manifest.yaml
env 'mcp-connections-bearer-token=any-non-empty-value' \
  yoizen manifests apply  -f ../integrations/mcp/mcp-connections/manifest.yaml --secrets-from-env
```

Una segunda `apply` es un no-op una vez convergido. Para verificar (solo lectura):

```bash
cd integrations/mcp/mcp-connections
./run.sh
```

`run.sh` (`src/index.ts`) confirma que el MCP server, el agente y el workflow existen; hace un
probe best-effort de `testConnection()`/`listTools()` (se espera un `[WARN]` — endpoint falso); e
imprime `enabled_mcp_tools`/`tool_description_overrides` del agente. Nunca crea ni modifica
objetos de la plataforma, y nunca ejecuta el workflow ni el agente — la URL del MCP server es
falsa/inalcanzable a propósito.

## Qué demuestra cada sección del manifest

- **`mcpServers[].auth`** — `authType`/`authConfig` tipados, solo `secretRef` (decisión 3 de
  T01/T06), reflejando `mcpServerAuthSchema` campo por campo.
- **`agents[].enabledMcpTools`** — allowlist por tool acotada a un MCP server, indexada por
  NOMBRE del servidor (nunca sustituido a un id — decisión 6, mismo precedente que
  `enabledMcpServerRefs`).
- **`agents[].toolDescriptionOverrides`** — claves `"<serverName>__<toolName>"` (doble guion bajo;
  antes era dos puntos, cambiado por agent-mcp-tool-naming.md T01 porque violaba el patrón de
  nombre de tool de OpenAI) para tools MCP, reconciliadas vía un PATCH dedicado después de
  crear/resolver el agente.
- **Acción `mcpCall` en `workflows[].definition`** — `serverId: { mcpServerRef: <nombre> }`, el
  ÚNICO lugar donde `mcpServerRef` participa en la sustitución nombre->id en tiempo de apply
  (`SUBSTITUTION_ALLOWLIST` de T06).

## Detalles y advertencias

- **El write de `enabledMcpTools` persiste pero puede no tener efecto en runtime** — depende del
  flag `AGENT_MCP_TOOL_FILTERING_ENABLED` en `agent-ai-service`; el dato siempre se persiste, el
  flag solo controla si se *aplica* en runtime.
- **`toolDescriptionOverrides` puede saltearse con un warning durante el apply** — gateado
  server-side por `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` en `agent-admin-service`. Un flag
  apagado es un estado válido de la plataforma; `agents-writer.ts` lo trata como un skip, no como
  un fallo.
- **¿Querés una integración MCP real en vez del endpoint falso?** Editá el `url` del
  `manifest.yaml` a un MCP server público y alcanzable desde el clúster (el guard SSRF de la
  plataforma bloquea URLs `localhost`/RFC1918) y volvé a aplicar — `testConnection`/`listTools`
  van a reportar resultados reales.
