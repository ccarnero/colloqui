# ai-skill-support-agent — Documentación funcional (ES)

> Complemento en español del [README.md](./README.md). No es una traducción: explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo.

## ¿Qué hace este sample?

Después de aplicar `manifest.yaml`, la plataforma queda con un agente de soporte de call center que
combina, en un solo agente, las dos funcionalidades del catálogo de IA de la plataforma:

1. Un **skill** del catálogo (AI > Skills): `refund-policy-expert`, un paquete de prompt
   reutilizable especializado en devoluciones y reembolsos, con comandos disparadores
   (`refund`, `reembolso`), pistas de enrutamiento (`when_to_use`, `priority`) y un archivo de
   referencia (cheat-sheet).
2. Una **knowledge base** (AI > Knowledge Bases): `ai-sample-callcenter-kb`, que contiene el manual
   de políticas de la empresa ficticia "Acme Telco"
   ([`policy/acme-telco-policy.md`](policy/acme-telco-policy.md)), fragmentado en chunks y embebido
   para búsqueda semántica (RAG) al momento de responder.

El provisioning es **declarativo**: un único [`manifest.yaml`](./manifest.yaml) aplicado con la CLI
`yoizen` (sin scripts de setup). Después, `run.sh` hace tres preguntas por la API de ejecuciones del
runtime, cada una diseñada para ejercitar un mecanismo distinto: el disparo del skill, el grounding
en la knowledge base y el guardrail de política.

## Decisión de `kind` (`kind: LibraryManifest`)

Este manifest provisiona un connector + un skill + una knowledge base + un agente — existe un
PROCESO (el agente), pero **no hay ningún canal**. `kind: LibraryManifest` exime las reglas de
>=1-canal/>=1-proceso y exige en su lugar al menos un recurso de biblioteca (connector/mcpServer/
service/systemVariable), satisfecho aquí por el connector LLM (las knowledge bases y los skills NO
cuentan para esta regla). Misma decisión que los samples hermanos `../ai-knowledge-base-agent` y
`../ai-agent-playground`.

## Qué provisiona `manifest.yaml`

| Recurso | Nombre | Notas |
| --- | --- | --- |
| Connector | `sample-openai-llm` | Idéntico byte a byte al de los demás samples de IA (compartido, sin ciclo de update). Reusado para el LLM del agente Y el proveedor de embeddings de la KB |
| Skill | `refund-policy-expert` | El quinto tipo de recurso (`skills[]`). Triggers `refund` / `reembolso`, un `files[]` de referencia (cheat-sheet), `mode: llm_driven` |
| Knowledge base | `ai-sample-callcenter-kb` | Un documento inline (`acme-telco-policy`), `ingestion_config.provider_connector_id: { connectorRef: sample-openai-llm }` |
| Agente | `ai-sample-support` | `knowledgeBaseRefs: [ai-sample-callcenter-kb]`, `model_config.llm.connectorId: { connectorRef: sample-openai-llm }`, y una entrada en `model_config.subagents[]` que enlaza el skill por `catalog_skill_id: { skillRef: refund-policy-expert }` más el snapshot completo |

## Cómo funciona por dentro

### El detalle honesto de `catalog_skill_id` (snapshot embebido)

Este es el concepto más importante del sample, verificado en el código de `agent-ai-service`:

- El skill `refund-policy-expert` se declara una sola vez en la sección `skills[]` de nivel
  superior (create-or-update por nombre vía `skills-writer.ts`, `POST/PATCH /admin/skills`).
- El agente lo referencia por `model_config.subagents[].catalog_skill_id`, una referencia simbólica
  `{ skillRef: refund-policy-expert }` (`manual-loops/provisioning-manifest-gaps-3.md` T02) resuelta
  al id real del skill al momento de aplicar — después de crear el skill, ya que `skill` va antes
  que `agent` en `RESOURCE_KIND_ORDER`.
- El runtime lee `model_config.subagents` **directamente**
  (`agent-config.postgres.repository.ts` lo mapea a `agent.skills`) y **NO** vuelve a consultar el
  skill del catálogo por `catalog_skill_id`. Ese campo es solo el enlace de vuelta al catálogo, no
  una referencia viva.
- Por eso, la entrada del subagente **también** lleva el snapshot completo del skill
  (`system_prompt`, `trigger_commands`, `when_to_use`, `priority`, `mode`) además de
  `catalog_skill_id`, para que el skill router (`skill-router.service.ts`) tenga esos campos en
  runtime.
- Consecuencia práctica: como es un snapshot y no una referencia viva, editar el skill en la
  sección `skills[]` obliga a editar también los campos del snapshot en el subagente. El manifest
  declara ambos desde los mismos valores, así que una edición normal + re-apply los mantiene
  sincronizados.

Algo similar ocurre con `files[]`: el cheat-sheet de reembolsos se guarda en el catálogo, pero la
herramienta builtin `loadSkill` del runtime lee paquetes `SKILL.md` desde el filesystem del
servicio (`skill-file.service.ts`), no desde la tabla de skills. El archivo demuestra el contrato
del catálogo; las instrucciones operativas viajan en el `system_prompt` del skill.

### Origen del documento (inline, no file/bundle)

El manual de políticas (originalmente `policy/acme-telco-policy.md`) se embebe VERBATIM en
`manifest.yaml` vía `type: inline` (~3,4 KiB, muy por debajo del límite de 64 KiB). `type: file`
(path + sha256, vía bundle tar) se descartó: la CLI `yoizen` no tiene un flag `--bundle` hoy — solo
el SDK acepta uno directamente — así que `type: file` sería inexpresable a través del flujo de CLI
de este README.

**Limitación** (igual que `../ai-knowledge-base-agent`): `documents[].name` en el schema es un slug
(sin puntos) y ES lo que se sube como `original_filename` del documento, así que la extensión `.md`
no se puede preservar (`acme-telco-policy` en vez de `acme-telco-policy.md`). La ingesta no se ve
afectada. Los campos `description`/`project`/`category`/`icon` de la KB (presentes en el viejo
`CreateKnowledgeBaseInput`) tampoco tienen campo en `knowledgeBaseSchema`, así que se descartan y
quedan con los valores por defecto del servidor — misma limitación documentada que el sample
hermano.

## Secretos (auth bearer del connector LLM/embedding)

| Binding (= var de entorno para `--secrets-from-env`) | Apunta a | Valor |
| --- | --- | --- |
| `ai-skill-support-agent-openai-api-key` | `authConfig.bearerToken` | Tu `OPENAI_API_KEY` real |

El NOMBRE del binding es de donde `--secrets-from-env` lee el VALOR — así que si tu clave de
proveedor vive en `OPENAI_API_KEY`, hay que remapearla en la línea de apply
(`env "ai-skill-support-agent-openai-api-key=$OPENAI_API_KEY" ...`). No hay ninguna transformación
automática de nombres.

## Cómo ejecutarlo y qué esperar

Prerrequisitos: clúster de desarrollo corriendo y una API key real de OpenAI. La búsqueda de KB en
runtime usa embeddings de OpenAI independientemente del connector, por lo que `agent-ai-service`
también necesita `OPENAI_API_KEY` en su propio entorno.

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-skill-support-agent/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-skill-support-agent/manifest.yaml
env "ai-skill-support-agent-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-skill-support-agent/manifest.yaml --secrets-from-env
```

Un segundo `apply` es no-op una vez convergido (el tracking por checksum del reconciler de KB evita
re-ingestar un documento sin cambios; skill/connector/agente reconcilian a un veredicto de
0-create/0-update por búsqueda por nombre).

```bash
cd integrations/ai/ai-skill-support-agent
./run.sh
```

`run.sh` (`src/index.ts`) es **de solo lectura**: resuelve el agente por nombre y envía tres
ejecuciones de runtime:

1. **Reembolso (trigger del skill)**: la pregunta **comienza** con el trigger `refund` → el router
   activa `refund-policy-expert` (compara `userMessage.startsWith(trigger)`). Respuesta que aplica
   la ventana de 30 días, el cargo de reposición del 15 %, el paso de RMA y el plazo de 5–7 días
   hábiles, citando la sección de política.
2. **SLA de envío (knowledge base)**: los datos de SLA existen solo en el documento de la KB →
   grounding por RAG. Cita el SLA express de 1–2 días hábiles en zonas metropolitanas y el crédito
   de USD 10, incluyendo `ACME-POLICY-V3-VERIFIED` cuando el contenido provino de la KB.
3. **Demanda fuera de política (guardrail)**: rechazo cortés y empático, sin promesa de reembolso,
   con oferta de escalación a Tier 2 Billing.

## Detalles y advertencias

- **El trigger es `startsWith`.** El router de skills compara `userMessage.startsWith(trigger)`: la
  primera pregunta debe **comenzar** con `refund` (o `reembolso`). Un mensaje que menciona "refund"
  en el medio no activa el skill por trigger.
- **El snapshot no se actualiza solo.** Editar el skill en `skills[]` no cambia el agente ya creado;
  hay que editar también los campos del snapshot en el subagente y volver a aplicar.
- **`files[]` es solo catálogo.** Los archivos del skill no llegan al runtime; el contenido
  operativo debe estar en el `system_prompt`.
- **Falta `ACME-POLICY-V3-VERIFIED` en la respuesta 2** → la KB no se recuperó en runtime: verificar
  que el documento esté en `ready` y que `agent-ai-service` tenga `OPENAI_API_KEY`.
- **"Agent not found" en `run.sh`** → falta aplicar `manifest.yaml` primero.
