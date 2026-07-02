# AI agent playground — documentación funcional (ES)

> Documento funcional en español. Para la referencia técnica completa, consulte [README.md](README.md).

## ¿Qué hace este sample?

Este sample crea un agente de IA real en la plataforma Yoizen, lo conecta a un LLM en línea (OpenAI por defecto), lo publica y ejecuta una conversación de prueba a través de la misma superficie de API que usan las páginas de IA de la admin-console.

Al finalizar la ejecución obtiene:

- Un connector HTTP habilitado con el tag `llm` que almacena la API key del proveedor.
- Un agente de IA publicado (`ai-sample-playground`) con su `model_config.llm` completo.
- Una ejecución de runtime completada, con la respuesta del modelo, el uso de tokens, el proveedor, el modelo y una estimación de costo cuando está disponible.

Es el sample de referencia para entender el contrato de aprovisionamiento de agentes: los samples más avanzados (`ai-knowledge-base-agent`, `ai-agent-triage`) reutilizan exactamente este mismo patrón de connector + agente + publicación.

**Verificado**: este sample se ejecutó con éxito contra el clúster de desarrollo con `gpt-4o-mini`.

## Escenario y caso de uso

Imagine un equipo de plataforma en un contact center que está evaluando Yoizen para automatizar respuestas. Antes de construir flujos complejos, necesitan responder una pregunta básica: **¿puede la plataforma crear un agente, dárselo a un LLM real y obtener una respuesta de punta a punta?**

Este sample es exactamente esa prueba de humo ("health check") de la capa de IA:

1. El operador coloca su `OPENAI_API_KEY` en `.env` y ejecuta `./run.sh`.
2. El script crea el connector, el agente y lo publica.
3. Envía el mensaje de prueba: *"Reply with one short sentence confirming the Yoizen AI sample is working."*
4. El runtime responde con algo como:

```json
{
  "executionId": "6f2c...",
  "state": "completed",
  "reply": "The Yoizen AI sample is working correctly.",
  "usage": { "promptTokens": 74, "completionTokens": 11, "totalTokens": 85 },
  "provider": "openai",
  "model": "gpt-4o-mini",
  "costUsd": 0.00002
}
```

Si esto funciona, la plataforma tiene resuelta la cadena completa: credenciales → agente publicado → ejecución de runtime → LLM en línea → respuesta con métricas de uso y costo.

## Cómo funciona por dentro

`run.sh` es un envoltorio delgado: carga `../lib/resolve-env.sh` (coordenadas del gateway y login seed compartidos con los demás samples) y ejecuta `setup.sh`, que corre estas etapas:

```
0/5 preflight   → valida jq/curl, el modo de credenciales y que la API key no sea un placeholder
1/5 login       → POST /api/auth/login → token Bearer (tenant acme)
2/5 connector   → crea o reutiliza el connector HTTP con tag "llm" (solo en modo connector)
3/5 agente      → upsert del agente + POST /api/admin/agents/:id/publish
4/5 ejecución   → POST /api/runtime/executions con el mensaje de prueba
5/5 polling     → GET /api/runtime/executions/:id hasta "completed" o "failed"
```

Puntos clave de cada etapa:

- **Connector LLM (etapa 2)**: se crea vía `POST /api/connectors` con `context: "external"`, `authType: "bearer"` (la API key va en `authConfig.bearerToken`), `tags: ["llm"]` y el `baseUrl` del proveedor (por ejemplo `https://api.openai.com/v1`). Si ya existe uno con el mismo nombre, se reutiliza y se actualiza con `PATCH`. El tag `llm` es obligatorio: sin él, la creación del agente rechaza el connector.
- **Agente (etapa 3)**: el payload incluye `system_prompt`, y `model_config.llm` con `provider`, `model`, `connectorId`, `temperature: 0.2` y `maxTokens: 256`. Un agente en borrador no es ejecutable: la publicación (`/publish`) es un paso obligatorio.
- **Ejecución (etapa 4)**: `POST /api/runtime/executions` con `agentId`, `message`, `conversationId`, `channel` y `userId`. La llamada al LLM no ocurre en el shell: la realiza `agent-ai-service` dentro del clúster, resolviendo las credenciales del connector a través de `CONNECTOR_ADMIN_URL`.
- **Polling (etapa 5)**: el script consulta el estado cada 2 segundos hasta `POLL_TIMEOUT_S` (90 s por defecto) y, al completar, imprime `reply`, `usage`, `provider`, `model` y `costUsd`.

### Modos de credenciales

| Modo | Qué hace | Cuándo usarlo |
| --- | --- | --- |
| `connector` (por defecto) | Guarda la API key en el connector y setea `model_config.llm.connectorId` en el agente. Es el flujo más parecido a la admin-console. | Siempre que sea posible. |
| `env` | Deja `connectorId` vacío; asume que `agent-ai-service` ya tiene la variable del proveedor (por ejemplo `OPENAI_API_KEY`) en su propio despliegue. | Solo si el servicio ya está configurado con la key. |

Advertencia importante del modo `env`: exportar `OPENAI_API_KEY` en la terminal donde corre el sample **no alcanza**, porque la llamada al LLM se ejecuta dentro de `agent-ai-service`, no en el script.

## Qué demuestra técnicamente

- **Contrato de aprovisionamiento de agentes**: la misma forma de payload que usa la UI (`services/admin-console/src/app/core/models/agent.model.ts`) contra el CRUD de agentes (`services/api-gateway/src/modules/admin/admin-agents.controller.ts`).
- **Ejecuciones de runtime**: `services/api-gateway/src/modules/runtime/runtime.controller.ts`.
- **Registro de proveedores LLM**: `services/agent-ai-service/src/modules/llm/provider-registry.service.ts` — soporta `openai`, `anthropic`, `google`, `groq`, `mistral`, `cohere`, `openrouter`, `xai`, `ollama` y `deepseek`.
- **Resolución de credenciales**: `services/agent-ai-service/src/modules/llm/credential-resolver.service.ts` — connector primero, variables de entorno del servicio como fallback.
- **Idempotencia**: connector y agente se resuelven por nombre y se actualizan en el lugar; `RECREATE=1` fuerza borrado y recreación.

## Cómo ejecutarlo y qué esperar

Prerrequisitos: `jq`, `curl`, acceso al gateway de desarrollo y una API key real del proveedor elegido.

```bash
cd sdk/samples/ai-agent-playground
cp .env.example .env
# editar .env: OPENAI_API_KEY=sk-...
./run.sh
```

Salida esperada (resumida):

```
[STEP]  0/5 preflight
[INFO]  credential mode=connector provider=openai model=gpt-4o-mini connector=sample-openai-llm
[STEP]  1/5 login as yclawd@demo.io (tenant acme)
[STEP]  2/5 ensure LLM connector 'sample-openai-llm'
[INFO]  created connector id=... baseUrl=https://api.openai.com/v1
[STEP]  3/5 upsert agent 'ai-sample-playground'
[INFO]  published agent id=...
[STEP]  4/5 create runtime execution
[STEP]  5/5 poll execution result
[INFO]  completed
{ "executionId": "...", "state": "completed", "reply": "...", "usage": {...}, ... }
```

Variables útiles: `AI_AGENT_PROVIDER` / `AI_AGENT_MODEL` para cambiar de proveedor, `AI_AGENT_MESSAGE` para cambiar el mensaje de prueba, `RECREATE=1` para recrear los recursos desde cero.

## Detalles y advertencias

- **`OPENAI_API_KEY is required`** — en modo connector la key debe estar en `.env`, y no puede ser un placeholder (`sk-...`, `your-...`, `replace-me`, `example` se rechazan en el preflight).
- **La ejecución falla por API key faltante** — típico del modo `env`: `agent-ai-service` no tiene la variable del proveedor en su despliegue. Use el modo connector o configure el servicio.
- **"adapter is not tagged as llm"** — existe un connector con el mismo nombre pero sin el tag `llm`. Ejecute con `RECREATE=1` o cambie `AI_LLM_CONNECTOR_NAME`.
- **El modo connector cae en fallback a env** — verifique que `agent-ai-service` tenga un `CONNECTOR_ADMIN_URL` válido capaz de resolver `GET /connectors/:id`.
- **Content-Type condicional** — el helper `api()` solo envía `Content-Type: application/json` cuando hay body: el parser JSON de Fastify devuelve 400 en llamadas DELETE/GET sin body si el header está presente. Un detalle pequeño, pero relevante si adapta el script.
- **`ollama` no exige API key** — es el único proveedor que el preflight deja pasar sin key (usa `http://localhost:11434/v1` por defecto).
