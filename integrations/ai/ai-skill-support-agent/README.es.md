# ai-skill-support-agent — Documentación funcional (ES)

> Documento funcional en español. No es una traducción del `README.md`; explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo. Para la referencia completa de
> contratos y troubleshooting en inglés, ver [`README.md`](README.md).

## ¿Qué hace este sample?

Provisiona un agente de soporte de call center que combina, en un solo agente, las dos
funcionalidades del catálogo de IA de la plataforma:

1. Un **skill** del catálogo (AI > Skills): `refund-policy-expert`, un paquete de prompt
   reutilizable especializado en devoluciones y reembolsos, con comandos disparadores
   (`refund`, `reembolso`), pistas de enrutamiento (`when_to_use`, `priority`) y un archivo de
   referencia (cheat-sheet).
2. Una **knowledge base** (AI > Knowledge Bases): `ai-sample-callcenter-kb`, que contiene el
   manual de políticas de la empresa ficticia "Acme Telco"
   ([`policy/acme-telco-policy.md`](policy/acme-telco-policy.md)), fragmentado en chunks y
   embebido para búsqueda semántica (RAG) al momento de responder.

Después, `run.sh` hace tres preguntas por la API de ejecuciones del runtime, cada una diseñada
para ejercitar un mecanismo distinto: el disparo del skill, el grounding en la knowledge base y
el guardrail de política.

## Escenario y caso de uso

Imagine el equipo de atención al cliente de **Acme Telco**, un operador de telefonía. Sus
agentes humanos responden todo el día preguntas sobre reembolsos, envíos y planes, y la empresa
tiene reglas estrictas: ventana de reembolso de 30 días para dispositivos (45 para clientes
Acme Max), cargo de reposición del 15 % después del día 15, RMA obligatorio antes de cualquier
devolución, y una matriz de escalación cuando el pedido queda fuera de política.

Este sample construye la versión IA de ese agente. Tres conversaciones reales (ejecutadas y
verificadas contra el cluster de desarrollo):

| # | Mensaje del cliente | Mecanismo ejercitado | Respuesta observada |
| --- | --- | --- | --- |
| 1 | "refund question: I bought a SmartHub router 20 days ago… Can I get my money back, and is there any fee?" | El mensaje comienza con el trigger `refund` → el skill router activa `refund-policy-expert` | Respuesta fundada en la sección 1 de la política: reembolso posible dentro de la **ventana de 30 días**, con cargo de reposición del 15 % por estar abierto y pasado el día 15, paso de **RMA** obligatorio y plazo de 5–7 días hábiles |
| 2 | "My express shipment to a metro area is 4 business days late. What is the express shipping SLA…?" | Los datos de SLA de envío existen solo en el documento de la KB → grounding por RAG | Cita el **SLA express de 1–2 días hábiles en áreas metropolitanas** y el crédito de USD 10 por exceder el SLA en más de 2 días; incluye la frase `ACME-POLICY-V3-VERIFIED` cuando la KB fue efectivamente recuperada |
| 3 | "I bought a phone 90 days ago and I demand a full cash refund today or I will post about it everywhere." | Demanda fuera de política → guardrail de `rules` | **Rechazo cortés** (fuera de la ventana de 30 días, sin reembolsos en efectivo) con oferta de **escalación a Tier 2 Billing** — sin prometer ningún reembolso |

Las tres ejecuciones completaron correctamente en el cluster de desarrollo con esas respuestas
fundadas en la política.

## Cómo funciona por dentro

### Provisionamiento (`setup.sh`, 7 etapas idempotentes)

```
0/7 preflight        verifica jq/curl, el documento de política y la API key del proveedor
1/7 login            POST /api/auth/login → token del tenant
2/7 connector LLM    crea o reutiliza 'sample-<provider>-llm' (tag "llm", authType bearer)
3/7 skill            POST/PATCH /api/admin/skills → 'refund-policy-expert'
4/7 knowledge base   POST/PATCH /api/admin/knowledge-bases → 'ai-sample-callcenter-kb'
                     (chunking recursivo: chunk_size 800 / overlap 120, embeddings OpenAI)
5/7 documento        upload de policy/acme-telco-policy.md + polling hasta status "ready"
6/7 agente           upsert de 'ai-sample-support' con el subagente-skill y knowledge_base_ids
7/7 publicación      POST /api/admin/agents/:id/publish
```

Reejecutar `setup.sh` reutiliza todo por nombre; `RECREATE=1` borra y reconstruye skill, KB,
documento y agente.

### Anatomía del agente

```
  AI > Skills (catálogo)                 AI > Knowledge Bases
  +---------------------------+         +----------------------------+
  | refund-policy-expert      |         | ai-sample-callcenter-kb    |
  |  system_prompt (pasos)    |         |  acme-telco-policy.md      |
  |  trigger_commands:        |         |  (reembolsos, SLAs de      |
  |    refund, reembolso      |         |   envío, escalación,       |
  |  when_to_use, priority    |         |   planes)                  |
  |  files: cheat-sheet (ref) |         |  -> chunks + embeddings    |
  +------------+--------------+         +-------------+--------------+
               | snapshot copiado a                   | knowledge_base_ids
               | model_config.subagents               | (RAG al responder)
               | (+ catalog_skill_id como enlace)     |
               v                                      v
        +---------------------------------------------------+
        | agente: ai-sample-support (publicado)             |
        |  soul: empático y profesional                     |
        |  rules: no prometer reembolsos fuera de política, |
        |         citar la sección aplicada                 |
        +-------------------------+-------------------------+
                                  |
                     POST /api/runtime/executions
```

### El detalle honesto de `catalog_skill_id` (snapshot embebido)

Este es el concepto más importante del sample, verificado en el código de `agent-ai-service`:

- El runtime lee `model_config.subagents` **directamente**
  (`agent-config.postgres.repository.ts` lo mapea a `agent.skills`) y convierte en definición
  de skill cada entrada que tenga `system_prompt`.
- El runtime **NO vuelve a consultar el skill del catálogo por `catalog_skill_id`**. Ese campo
  es solo el enlace de vuelta al catálogo, no una referencia viva.
- Por eso, tanto la admin console como este `setup.sh` copian el **snapshot completo** del
  skill dentro de la entrada del subagente: `system_prompt`, `trigger_commands`, `when_to_use`,
  `priority` y `mode` viajan embebidos, para que el skill router
  (`skill-router.service.ts`) realmente los tenga disponibles en runtime.
- Consecuencia práctica: si se edita el skill en el catálogo después de crear el agente, el
  agente **no** ve el cambio hasta que se vuelva a copiar el snapshot (re-ejecutando
  `setup.sh`, por ejemplo).

Algo similar ocurre con `files[]`: el cheat-sheet de reembolsos se guarda en el catálogo, pero
la herramienta builtin `loadSkill` del runtime lee paquetes `SKILL.md` desde el filesystem del
servicio (`skill-file.service.ts`), no desde la tabla de skills. El archivo demuestra el
contrato del catálogo; las instrucciones operativas viajan en el `system_prompt` del skill.

### Ingesta de la knowledge base

El documento de política se sube como markdown (`content_text` en el body), se fragmenta con
estrategia `recursive` (chunks de 800 caracteres con solapamiento de 120) y se embebe con
`text-embedding-3-small`. `setup.sh` hace polling del documento hasta `status: ready` y reporta
el `chunk_count`. En runtime, la búsqueda semántica sobre esos chunks aporta el contexto de la
respuesta (RAG).

### Flujo de una pregunta (`run.sh`)

1. Login y resolución del agente por nombre (`ai-sample-support`).
2. `POST /api/runtime/executions` con `{ agentId, message, conversationId, channel, ... }`.
3. Polling de `GET /api/runtime/executions/:id` hasta `completed` (o `failed` / timeout).
4. Se imprime la respuesta, el uso de tokens, el proveedor/modelo y el costo estimado.

## Qué demuestra técnicamente

| Aspecto | Feature de la plataforma | Fuente del contrato (del README en inglés) |
| --- | --- | --- |
| CRUD de skills | AI > Skills | `services/api-gateway/src/modules/admin/admin-skills.controller.ts`, `services/agent-admin-service/src/modules/skills/skills.dto.ts` |
| Campos del skill | `name, system_prompt, trigger_commands, when_to_use, priority, allowed_tools, mode, files[]` | `services/agent-admin-service/src/modules/skills/skills.service.ts` (`ISkill`) |
| Skill adjunto al agente | `model_config.subagents[]` con `catalog_skill_id` + snapshot | `services/admin-console/src/app/core/models/agent.model.ts` (`ISubagentConfig`) |
| Ruteo de skills en runtime | resolución por trigger / nombre / semántica / prioridad | `services/agent-ai-service/src/modules/skills/skill-router.service.ts` |
| Subagente → definición de skill | entradas con `system_prompt` mapeadas como catalog skills | `services/agent-ai-service/src/modules/chat/chat.service.ts`, `.../skills/skill-mapper.ts` |
| KB + ingesta + polling | AI > Knowledge Bases | mismo contrato que `../ai-knowledge-base-agent/setup.sh` |
| Upsert + publish del agente | AI > Agents | `services/api-gateway/src/modules/admin/admin-agents.controller.ts` |
| Preguntas al agente | runtime executions | `services/api-gateway/src/modules/runtime/runtime.controller.ts` |

## Cómo ejecutarlo y qué esperar

### Prerrequisitos

- Cluster de desarrollo accesible a través de `api-gateway` (ver `../lib/resolve-env.sh`).
- Una API key de proveedor LLM (por defecto OpenAI) en `.env`. **No hace falta Telegram ni
  ningún canal**: `run.sh` habla con el agente por la API de ejecuciones del runtime.
- La búsqueda de KB en runtime usa embeddings de OpenAI, por lo que `agent-ai-service` también
  necesita `OPENAI_API_KEY` en su propio entorno de despliegue.

### Comandos

```bash
cd integrations/ai/ai-skill-support-agent
cp .env.example .env    # completar OPENAI_API_KEY (u otra clave de proveedor)
./setup.sh
./run.sh
```

### Salida esperada

Tres ejecuciones completadas (verificado en el cluster de desarrollo):

1. **Reembolso (trigger del skill)**: respuesta que aplica la ventana de 30 días, menciona el
   cargo de reposición del 15 %, el paso de RMA y el plazo de 5–7 días hábiles, citando la
   sección de política aplicada.
2. **SLA de envío (knowledge base)**: respuesta con el SLA express de 1–2 días hábiles en zonas
   metropolitanas y el crédito de USD 10, incluyendo `ACME-POLICY-V3-VERIFIED` cuando el
   contenido provino de la KB.
3. **Demanda fuera de política (guardrail)**: rechazo cortés y empático, sin promesa de
   reembolso, con oferta de escalación a Tier 2 Billing.

## Detalles y advertencias

- **El trigger es `startsWith`.** El router de skills compara
  `userMessage.startsWith(trigger)`: la primera pregunta debe **comenzar** con `refund` (o
  `reembolso`). Un mensaje que menciona "refund" en el medio no activa el skill por trigger.
- **El snapshot no se actualiza solo.** Editar el skill en el catálogo no cambia el agente ya
  creado; hay que volver a copiar el snapshot al subagente (re-ejecutar `setup.sh`).
- **`files[]` es solo catálogo.** Los archivos del skill no llegan al runtime; el contenido
  operativo debe estar en el `system_prompt`.
- **Falta `ACME-POLICY-V3-VERIFIED` en la respuesta 2** → la KB no se recuperó en runtime:
  verificar que el documento esté en `ready` y que `agent-ai-service` tenga `OPENAI_API_KEY`.
- **`conversationId` fijo.** `run.sh` usa siempre `ai-skill-support-agent` como
  `conversationId`, así que las tres preguntas comparten un mismo hilo de conversación. Una
  integración real debería derivarlo por cliente.
- **Errores de connector** → ejecutar con `RECREATE=1` o cambiar `AI_LLM_CONNECTOR_NAME`. El
  connector `sample-<provider>-llm` se comparte con otros samples de IA; re-ejecutar cualquiera
  actualiza la clave/baseUrl en el mismo registro.
- **"Agent not found" en `run.sh`** → falta ejecutar `./setup.sh` primero.
