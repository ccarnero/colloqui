# AI knowledge-base agent — documentación funcional (ES)

> Documento funcional en español. Para la referencia técnica completa, consulte [README.md](README.md).

## ¿Qué hace este sample?

Este sample demuestra el ciclo completo de RAG (Retrieval-Augmented Generation) de la plataforma: crea una knowledge base, sube un documento Markdown con una FAQ de soporte, espera a que la ingesta genere los chunks con embeddings, adjunta la knowledge base a un agente de IA publicado y finalmente le hace una pregunta cuya respuesta **solo existe en el documento subido**.

Al finalizar obtiene:

- Un connector LLM (`sample-<provider>-llm`, compartido con `ai-agent-playground`).
- Una knowledge base `ai-sample-support-kb` con chunking recursivo y embeddings de OpenAI.
- El documento `docs/support-faq.md` ingerido, con estado `ready` y sus chunks embebidos.
- Un agente publicado con `knowledge_base_ids: [<kb id>]`.
- Una ejecución de runtime cuya respuesta explica la política de reembolsos de la FAQ e incluye la frase de verificación `CONDOR-KB-READY`.

**Verificado**: este sample se ejecutó con éxito contra el clúster de desarrollo con `gpt-4o-mini`.

## Escenario y caso de uso

Piense en un equipo de soporte de una empresa SaaS. La política de reembolsos, las reglas de escalamiento y los horarios de atención viven en documentos internos, y cada agente humano los responde de memoria — con inconsistencias inevitables. El objetivo: que un agente de IA responda **con la política real de la empresa**, no con lo que el modelo "cree" que es una política de reembolsos típica.

El documento de ejemplo (`docs/support-faq.md`) contiene:

- **Política de reembolsos**: reembolsos para pedidos digitales dentro de los 14 días si el cliente no usó más del 20 % de los créditos; procesados al medio de pago original en cinco días hábiles.
- **Regla de escalamiento**: cuentas Enterprise se escalan al equipo de success ante caídas de producción, disputas de facturación o pedidos de exportación de datos.
- **Horarios de soporte**: lunes a viernes de 09:00 a 18:00 (hora de Argentina); Enterprise con cobertura 24x7.
- **Frase de verificación**: `CONDOR-KB-READY` — el detalle clave del sample.

La pregunta que envía el runtime:

> "According to the support FAQ, what is the refund policy? Include the verification phrase if you see one."

Y una respuesta correcta luce así:

> "According to the support FAQ, refunds are available for digital orders within 14 days when less than 20 percent of the purchased credits have been used, processed back to the original payment method within five business days. CONDOR-KB-READY."

La frase `CONDOR-KB-READY` es la prueba objetiva de que la respuesta salió de la knowledge base: ningún LLM la conoce por preentrenamiento. Si la respuesta describe una política plausible pero **no** incluye la frase, el agente respondió de memoria del modelo — el RAG no funcionó, aunque todo el aprovisionamiento haya salido bien. Esa distinción es exactamente lo que este sample está diseñado para hacer visible.

## Cómo funciona por dentro

`run.sh` carga `../lib/resolve-env.sh` y ejecuta `setup.sh`, que corre ocho etapas:

```
0/7 preflight   → valida jq/curl, el archivo del documento, el modo de credenciales
1/7 login       → POST /api/auth/login → token Bearer
2/7 connector   → connector con tag "llm" (credenciales para el agente y la ingesta)
3/7 kb          → POST /api/admin/knowledge-bases (chunking + modelo de embeddings)
4/7 documento   → POST .../documents/upload (o reingest si ya existe)
5/7 espera      → polling del documento hasta status "ready" (o "failed")
6/7 agente      → upsert + publish del agente con knowledge_base_ids
7/7 ejecución   → POST /api/runtime/executions + polling del resultado
```

Detalles relevantes:

- **Knowledge base (etapa 3)**: se crea con `ingestion_config`: `chunk_size: 800`, `chunk_overlap: 120`, `chunking_strategy: "recursive"` y `embedding_model` (`text-embedding-3-small` por defecto). En modo connector también se setea `provider_connector_id`, que da a la ingesta las credenciales del proveedor.
- **Documento (etapa 4)**: se sube como JSON (`original_filename`, `mime_type: "text/markdown"`, `content_text` con el contenido completo). Si ya existe un documento con el mismo nombre, se solicita un `reingest` en lugar de duplicarlo.
- **Ingesta asíncrona (etapa 5)**: la ingesta corre en segundo plano; el script hace polling cada 3 segundos hasta `DOC_TIMEOUT_S` (120 s). El estado pasa por `pending`/`processing` hasta `ready`, y al terminar reporta `chunk_count`.
- **Agente (etapa 6)**: igual que en `ai-agent-playground`, pero con dos diferencias: `knowledge_base_ids: [<kb id>]` conecta la KB al agente, y se habilita la herramienta builtin `loadSkill` únicamente para que la ejecución use la ruta de runtime con soporte de herramientas. El `system_prompt` instruye responder desde la knowledge base e incluir la frase de verificación si aparece.
- **Ejecución (etapa 7)**: `POST /api/runtime/executions` con la pregunta sobre reembolsos, y polling hasta `completed`. En tiempo de consulta, `agent-ai-service` usa los `knowledge_base_ids` del agente para buscar los chunks relevantes (búsqueda semántica con embeddings) e inyectarlos en el contexto del LLM.

### ¿Las knowledge bases son solo para agentes?

No. Son recursos administrativos independientes bajo `/api/admin/knowledge-bases`: se pueden crear, subir documentos, inspeccionar chunks y reingerir sin ningún agente. Pero **hoy el único consumidor de RAG en runtime es el agente**, vía `knowledge_base_ids`. En resumen: las KB son activos de contenido independientes; los agentes son el consumidor actual en runtime.

## Qué demuestra técnicamente

- **CRUD de knowledge bases y documentos**: `/api/admin/knowledge-bases`, subida de documentos, reingest, inspección de estado y chunks.
- **Pipeline de ingesta**: chunking recursivo configurable + embeddings, con `provider_connector_id` como fuente de credenciales para la ingesta.
- **RAG adjunto al agente**: `knowledge_base_ids` en el payload del agente, consumido por `agent-ai-service` al generar la respuesta.
- **Verificación honesta del RAG**: la frase `CONDOR-KB-READY` distingue una respuesta con retrieval real de una alucinación plausible.
- **Reutilización del contrato de `ai-agent-playground`**: mismo connector LLM, mismo flujo de upsert + publish, mismos requisitos de runtime.

## Cómo ejecutarlo y qué esperar

Prerrequisitos: `jq`, `curl`, acceso al gateway de desarrollo y `OPENAI_API_KEY` (u otra key si cambia el proveedor del agente — pero vea la advertencia sobre embeddings más abajo).

```bash
cd sdk/samples/ai-knowledge-base-agent
cp .env.example .env
# editar .env: OPENAI_API_KEY=sk-...
./run.sh
```

Salida esperada (resumida):

```
[STEP]  3/7 ensure knowledge base 'ai-sample-support-kb'
[INFO]  created knowledge base id=...
[STEP]  4/7 upload/reingest document 'support-faq.md'
[INFO]  uploaded document id=...
[STEP]  5/7 wait for document ingestion
[INFO]  document ready chunks=2
[STEP]  6/7 upsert + publish KB-backed agent 'ai-sample-kb-agent'
[STEP]  7/7 execute KB-backed question
[INFO]  completed
{ "reply": "... within 14 days ... CONDOR-KB-READY ...", "provider": "openai", "model": "gpt-4o-mini", ... }
```

El criterio de éxito es doble: la respuesta describe la política de 14 días / 20 % de créditos / cinco días hábiles, **y** contiene `CONDOR-KB-READY`.

Variables útiles: `KB_NAME`, `KB_EMBEDDING_MODEL`, `AI_AGENT_MESSAGE`, `RECREATE=1` (recrea KB, documento, connector y agente), `DOC_TIMEOUT_S` y `POLL_TIMEOUT_S`.

## Detalles y advertencias

- **Dos necesidades de IA en línea, no una**: (1) la generación del agente necesita un LLM, y (2) la ingesta **y la búsqueda en tiempo de consulta** necesitan embeddings. El modo connector cubre las credenciales de la ingesta vía `provider_connector_id`, pero la búsqueda de KB en runtime dentro de `agent-ai-service` usa embeddings de OpenAI directamente — el despliegue del servicio necesita `OPENAI_API_KEY` en su propio entorno. Configurarla solo en su shell puede no ser suficiente.
- **Provisiona bien pero responde de memoria**: si todo se crea sin errores pero la respuesta no incluye `CONDOR-KB-READY`, la KB no se recuperó en runtime. Verifique que `agent-ai-service` tenga `OPENAI_API_KEY` y que el documento esté en estado `ready`.
- **La ingesta es asíncrona**: no asuma que el documento está listo tras el upload; el script hace polling por diseño. Con documentos grandes, suba `DOC_TIMEOUT_S`.
- **"adapter is not tagged llm"** — connector homónimo sin el tag `llm`; use `RECREATE=1` o renombre `AI_LLM_CONNECTOR_NAME`.
- **Falla de ingesta sin API key** — configure `OPENAI_API_KEY`, o use modo connector con un connector-admin URL alcanzable desde `agent-admin-service`.
- **El aprovisionamiento funciona pero el runtime falla** — aplican los mismos requisitos de LLM que en `../ai-agent-playground` (vea su sección de troubleshooting).
