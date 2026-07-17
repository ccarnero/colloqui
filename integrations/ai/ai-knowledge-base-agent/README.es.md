# ai-knowledge-base-agent — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de aplicar `manifest.yaml`, la plataforma queda con **una base de conocimiento** con un
documento FAQ inline, adjuntada a un **agente publicado**, que responde una pregunta cuya respuesta
solo existe en ese documento (RAG). El provisioning es **declarativo**: un único
[`manifest.yaml`](./manifest.yaml) aplicado con la CLI `yoizen`.

## Decisión de `kind` (`kind: LibraryManifest`)

Este manifest provisiona un connector + una base de conocimiento + un agente — existe un PROCESO
(el agente), pero **no hay ningún canal**. `kind: LibraryManifest` exime las reglas de >=1-canal/
>=1-proceso y exige en su lugar al menos un recurso de biblioteca, satisfecho aquí por el connector
(las bases de conocimiento NO cuentan para esta regla).

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| Connector | `sample-openai-llm` | Reusado para el LLM del agente Y el proveedor de embeddings de la KB |
| Base de conocimiento | `ai-sample-support-kb` | Un documento inline (`support-faq`), `ingestion_config.provider_connector_id: { connectorRef: sample-openai-llm }` |
| Agente | `ai-sample-kb-agent` | `knowledgeBaseRefs: [ai-sample-support-kb]` |

## Origen del documento (inline, no file/bundle)

El contenido del FAQ se embebe VERBATIM en `manifest.yaml` vía `type: inline` (781 bytes, muy por
debajo del límite de 64 KiB). `type: file` (path + sha256, vía bundle tar) se descartó: la CLI
`yoizen` no tiene un flag `--bundle` hoy — solo el SDK acepta uno directamente — así que `type:
file` sería inexpresable a través del flujo de CLI de este README.

**Limitación**: `documents[].name` en el schema es un slug (sin puntos), así que la extensión `.md`
no se puede preservar verbatim (`support-faq` en vez de `support-faq.md`). La ingesta no se ve
afectada: `uploadTextDocument` fija `mime_type: text/plain`/`content_type: text` para fuentes
inline sin importar la extensión del nombre.

## Secretos (auth bearer del connector LLM/embedding)

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `ai-knowledge-base-agent-openai-api-key` | `authConfig.bearerToken` | Tu `OPENAI_API_KEY` real |

## Cómo ejecutarlo y qué esperar

Prerrequisitos: clúster de desarrollo corriendo, una API key real de OpenAI (también debe estar
presente en el entorno propio de `agent-ai-service`, ya que la búsqueda RAG en runtime usa
embeddings de OpenAI independientemente del connector).

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-knowledge-base-agent/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-knowledge-base-agent/manifest.yaml
env "ai-knowledge-base-agent-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-knowledge-base-agent/manifest.yaml --secrets-from-env
```

```bash
cd integrations/ai/ai-knowledge-base-agent
./run.sh
```

`run.sh` resuelve el agente por nombre, envía una pregunta sobre la política de reembolsos, hace
polling, e imprime el resultado. La respuesta debería mencionar la frase de verificación
`CONDOR-KB-READY`.

## Detalles y advertencias

- Editar el contenido del FAQ, el chunking o el modelo de embedding requiere editar
  `manifest.yaml` y volver a aplicar.
- Si la respuesta nunca menciona `CONDOR-KB-READY`, verificá que `OPENAI_API_KEY` esté seteada en
  el entorno propio de `agent-ai-service` (camino de embeddings/búsqueda), no solo en el binding de
  secreto del manifest (camino de auth del connector).
