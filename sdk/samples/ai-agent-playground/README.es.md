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

1. El operador coloca su `OPENAI_API_KEY` en `.env` y ejecuta `./setup.sh`.
2. El script crea el connector, el agente y lo publica.
3. Con `./run.sh` envía el mensaje de prueba: *"Reply with one short sentence confirming the Yoizen AI sample is working."*
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

`setup.sh` y `run.sh` son envoltorios delgados: cargan `../lib/resolve-env.sh` (coordenadas del gateway y login seed compartidos con los demás samples) y ejecutan la app Node correspondiente vía `tsx`, a través de `@yoizen/platform-sdk` (`client.connectors`, `client.agents`, `client.runtime`). La lógica real vive en `src/setup.ts` (aprovisionamiento) y `src/index.ts` (ejecución):

```
setup.sh → src/setup.ts
  0/2 preflight   → valida el modo de credenciales y que la API key no sea un placeholder
  1/2 connector   → crea o reutiliza el connector HTTP con tag "llm" (solo en modo connector)
  2/2 agente      → upsert del agente + publish()

run.sh → src/index.ts   (requiere haber corrido ./setup.sh antes)
  1/3 resolver agente → busca el agente publicado por nombre
  2/3 ejecución        → createExecution() con el mensaje de prueba
  3/3 polling           → getExecution() hasta "completed" o "failed"
```

Puntos clave de cada etapa:

- **Connector LLM (`setup.ts`, etapa 1)**: se crea vía `client.connectors.create()` con `context: "external"`, `authType: "bearer"` (la API key va en `authConfig.bearerToken`), `tags: ["llm"]` y el `baseUrl` del proveedor (por ejemplo `https://api.openai.com/v1`). Si ya existe uno con el mismo nombre, se reutiliza y se actualiza con `client.connectors.update()`. El tag `llm` es obligatorio: sin él, la creación del agente rechaza el connector.
- **Agente (`setup.ts`, etapa 2)**: el payload incluye `system_prompt`, y `model_config.llm` con `provider`, `model`, `connectorId`, `temperature: 0.2` y `maxTokens: 256`. Un agente en borrador no es ejecutable: la publicación (`client.agents.publish()`) es un paso obligatorio.
- **Ejecución (`index.ts`, etapa 2)**: `client.runtime.createExecution()` con `agentId`, `message`, `conversationId`, `channel` y `userId`. La llamada al LLM no ocurre en el shell: la realiza `agent-ai-service` dentro del clúster, resolviendo las credenciales del connector a través de `CONNECTOR_ADMIN_URL`.
- **Polling (`index.ts`, etapa 3)**: el script consulta `client.runtime.getExecution()` cada 2 segundos hasta `POLL_TIMEOUT_S` (90 s por defecto) y, al completar, imprime `reply`, `usage`, `provider`, `model` y `costUsd`.

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

Prerrequisitos: Node.js >=18, acceso al gateway de desarrollo y una API key real del proveedor elegido.

```bash
cd sdk/samples/ai-agent-playground
cp .env.example .env
# editar .env: OPENAI_API_KEY=sk-...
./setup.sh
./run.sh
```

Salida esperada de `./setup.sh` (resumida):

```
[STEP]  0/2 preflight
[INFO]  credential mode=connector provider=openai model=gpt-4o-mini connector=sample-openai-llm
[STEP]  1/2 ensure LLM connector 'sample-openai-llm'
[INFO]  created connector id=... baseUrl=https://api.openai.com/v1
[STEP]  2/2 upsert agent 'ai-sample-playground'
[INFO]  published agent id=...
[INFO]  Done. Agent 'ai-sample-playground' (...) is published.
```

Salida esperada de `./run.sh` (resumida):

```
[run] 1/3 resolving agent 'ai-sample-playground' ...
[run]     agent found (id=...)
[run] 2/3 creating runtime execution...
[run] 3/3 polling execution result...
[run]     completed
{ "executionId": "...", "state": "completed", "reply": "...", "usage": {...}, ... }
```

Variables útiles: `AI_AGENT_PROVIDER` / `AI_AGENT_MODEL` para cambiar de proveedor, `AI_AGENT_MESSAGE` para cambiar el mensaje de prueba, `RECREATE=1` para recrear los recursos desde cero.

## Detalles y advertencias

- **`OPENAI_API_KEY is required`** — en modo connector la key debe estar en `.env`, y no puede ser un placeholder (`sk-...`, `your-...`, `replace-me`, `example` se rechazan en el preflight).
- **La ejecución falla por API key faltante** — típico del modo `env`: `agent-ai-service` no tiene la variable del proveedor en su despliegue. Use el modo connector o configure el servicio.
- **"adapter is not tagged as llm"** — existe un connector con el mismo nombre pero sin el tag `llm`. Ejecute con `RECREATE=1` o cambie `AI_LLM_CONNECTOR_NAME`.
- **El modo connector cae en fallback a env** — verifique que `agent-ai-service` tenga un `CONNECTOR_ADMIN_URL` válido capaz de resolver `GET /connectors/:id`.
- **`agente 'ai-sample-playground' not found`** — corrió `./run.sh` sin haber corrido `./setup.sh` antes; el agente aún no existe.
- **`ollama` no exige API key** — es el único proveedor que el preflight deja pasar sin key (usa `http://localhost:11434/v1` por defecto).
