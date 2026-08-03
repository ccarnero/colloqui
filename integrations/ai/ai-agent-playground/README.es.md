# ai-agent-playground — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de aplicar `manifest.yaml`, la plataforma queda con **un connector LLM** con auth tipada
(`authType: bearer` vía `secretRef`) y **un agente publicado** apuntando a ese connector. Es la
forma mínima posible de "connector -> agente -> ejecución" a través de
`@yoizen/platform-sdk`. El provisioning es **declarativo**: un único
[`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen` (sin scripts de setup).

## Decisión de `kind` (`kind: LibraryManifest`)

Este manifest provisiona un connector + un agente — existe un PROCESO (el agente), pero **no hay
ningún canal**. Un `IntegrationManifest` exige incondicionalmente al menos un canal inbound;
`kind: LibraryManifest` exime esa regla (y la de >=1-proceso) y exige en su lugar al menos un
recurso de biblioteca (connector/mcpServer/service/systemVariable), satisfecho aquí por el
connector LLM. Verificado localmente contra `integrationManifestSchema.safeParse` +
`validateManifestStructuralRules` antes de comitear este manifest.

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| Connector | `sample-openai-llm` | `type: llm`, `authType: bearer` vía `secretRef`, `tags: [llm]` |
| Agente | `ai-sample-playground` | `model_config.llm.connectorId: { connectorRef: sample-openai-llm }`, publicado |

`tags: [llm]` NO es decorativo: el resolver de credenciales de agent-admin-service exige el tag
`llm` en el adapter al que apunta `model_config.llm.connectorId` de un agente — sin él, todo agente
que lo referencie es rechazado con `Adapter '<id>' is not tagged as 'llm'`
(`services/agent-admin-service/src/modules/agents/agents.service.ts`). "Publicado" tampoco es un
campo del manifest: `publishAgent()` de `agents-writer.ts` corre como ÚLTIMO paso de cada create Y
de cada update, así que un agente declarado en un manifest siempre queda publicado.

## Secretos (auth bearer del connector LLM)

El `setup.ts` eliminado creaba/reusaba un connector HTTP habilitado etiquetado `llm` con
`authConfig: { bearerToken: apiKey }` — el bloque `auth` de manifest v1 es `secretRef`-only por
schema, así que el manifest expresa `authType: bearer` con un `secretRef` anidado en su lugar:

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `ai-agent-playground-openai-api-key` | `authConfig.bearerToken` | Tu `OPENAI_API_KEY` real |

## Cómo ejecutarlo y qué esperar

Prerrequisitos: un clúster de desarrollo corriendo, una API key real de OpenAI, y las variables de
entorno habituales (`YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
`YOIZEN_PASSWORD`).

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-agent-playground/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-agent-playground/manifest.yaml
env "ai-agent-playground-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-agent-playground/manifest.yaml --secrets-from-env
```

Una segunda `apply` es un no-op una vez convergido. Para ejecutar (solo lectura):

```bash
cd integrations/ai/ai-agent-playground
./run.sh
```

`run.sh` (`src/index.ts`) resuelve el agente por nombre, envía una ejecución de runtime, hace
polling hasta `completed`/`failed`, e imprime el resultado. Nunca crea ni modifica objetos de la
plataforma.

## Detalles y advertencias

- Editar el provider/modelo/connector requiere editar `manifest.yaml` y volver a aplicar — ya no
  hay override por variable de entorno en cada corrida (el manifest ES la configuración).
- `run.sh` solo busca el agente por nombre; nunca provisiona nada, así que un nombre distinto entre
  `.env`/variables de entorno y `manifest.yaml` falla con "agent not found — apply manifest.yaml
  first".
- Las únicas variables que `run.sh` lee del `.env` local (cargado por `../../lib/resolve-env.sh`)
  son `AI_AGENT_NAME`, `AI_AGENT_MESSAGE` y `POLL_TIMEOUT_S`. `OPENAI_API_KEY` aparece en
  `.env.example` solo como recordatorio: `--secrets-from-env` lee el VALOR desde el nombre del
  BINDING (`ai-agent-playground-openai-api-key`), así que poner `OPENAI_API_KEY` en el `.env` no
  alcanza para el `apply` — hay que remapearlo en la línea de apply como muestra el bloque de
  arriba.
