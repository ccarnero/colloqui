# ai-call-center-supervisor — Documentación funcional (ES)

> Documento funcional en español. No es una traducción del `README.md`; explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo. Para la referencia completa de
> contratos y troubleshooting en inglés, ver [`README.md`](README.md).

## ¿Qué hace este sample?

Es el sample **integrador** (capstone): combina en un solo workflow todos los ingredientes que
los demás samples introducen de a uno — un **hosted service** en Knative (un CRM simulado), un
**agente de IA** invocado con `agentCall`, ruteo con un gateway `conditional` y escalación por
**Telegram** con `channelSend`.

Un mensaje de cliente llega por una instancia HTTP dedicada; el workflow consulta al cliente en
el CRM simulado (`serviceCall`), le pide a un agente de triage de IA un veredicto en JSON
estricto, y rutea el resultado: los mensajes con riesgo (enojo, amenaza de baja, reembolsos
altos) llegan al chat de Telegram de un supervisor humano como alerta de escalación; los
mensajes de rutina llegan como resumen de resolución automática.

## Escenario y caso de uso

Imagine el centro de atención de **Acme Telco**. Cada día entran cientos de mensajes: la
mayoría son consultas de rutina que un flujo automático puede resolver, pero un porcentaje son
clientes en riesgo real de baja — facturas mal cobradas por tercera vez, amenazas de acción
legal, demandas de reembolso. El costo de que uno de esos mensajes se pierda en la cola es
altísimo, y el costo de que un supervisor humano lea *todos* los mensajes también.

Este sample construye un **supervisor de IA que filtra la cola**: consulta el registro CRM del
cliente para dar contexto al triage, decide si el caso escala, y solo interrumpe al supervisor
humano cuando corresponde. Dos conversaciones reales (ejecutadas y verificadas contra el
cluster de desarrollo):

| # | Cliente | Mensaje | Veredicto del agente | Resultado observado |
| --- | --- | --- | --- | --- |
| 1 | `cust-1001` | "third time my bill is wrong, I want a $200 refund or I cancel" | reembolso > USD 100 + amenaza de baja + sentimiento muy negativo → `escalate: true` | matchedBranch **"Escalate to supervisor"** → 🚨 SUPERVISOR ESCALATION en Telegram, con prioridad, motivo y respuesta sugerida |
| 2 | `cust-2002` | "how do I update my email address?" | consulta de rutina → `escalate: false` | rama **default** → ✅ AUTO-RESOLVED en Telegram, con la respuesta sugerida por el agente |

En ambas ejecuciones el `serviceCall` al CRM respondió con `status: 200` (verificado en vivo).

## Cómo funciona por dentro

### Anatomía del workflow

```
HTTP msg ─► trigger (message_received, channels:["http"], anclado a la instancia del sample)
              │
              ▼
            lookupCustomer    serviceCall  → hosted service 'sample-crm' (echo server)
                              POST /crm/customers/lookup {customerId, message, source}
              ▼
            buildTriageInput  jsFunction   → JSON.stringify({customer_message,
                              customer_id, crm_record}) en un único string
              ▼
            triage            agentCall    → agente 'ai-sample-supervisor' (temperature 0.1,
                              prompt de JSON estricto) devuelve
                              {"escalate":bool,"reason","suggested_reply","priority"}
              ▼
            decide            jsFunction   → parsea el JSON del agente de forma segura
                              (fallback = escalate:true) y arma alertText / resolvedText
              ▼
            route             conditional  (gateway exclusivo — gana la primera coincidencia)
              ├── escalate == "true" ──► notifyEscalation  channelSend telegram 🚨
              └── default            ──► notifyResolved    channelSend telegram ✅
```

### El CRM es un hosted service en Knative

`setup.sh` registra `sample-crm` vía `POST /api/registry/services` (imagen
`ealen/echo-server:latest`) y espera la condición `Ready` de Knative. El echo server devuelve
la request tal cual la recibe, así que `results.lookupCustomer.data` contiene el body
`{customerId, message, source}` que el workflow envió — un registro CRM de mentira que el
agente ve literal dentro de `crm_record`. Cambiar `CRM_SERVICE_IMAGE` por un servicio real lo
convierte en un CRM de verdad sin tocar el workflow.

Punto de contrato clave: `serviceCall.serviceId` **debe ser el UUID** de la fila en
`registered_services`, nunca el slug. `setup.sh` lo resuelve por nombre al momento de
provisionar y además pasa `serviceSlug` para que `connector-runtime` pueda resolver el adapter
espejo sin una vuelta al registry.

### Por qué existe `buildTriageInput`

El templating `{{…}}` del executor coerciona cada hoja con `String()`: poner
`{{results.lookupCustomer.data}}` directamente en el `message` del agente produciría
`[object Object]`. El paso `buildTriageInput` es un `jsFunction` que hace
`JSON.stringify` del payload completo y devuelve `{ text: ... }`; el `agentCall` referencia
`{{results.buildTriageInput.text}}`, que ya es un string.

### `decide` es fail-safe

El paso `decide` limpia code fences, extrae el `{…}` más externo y hace `JSON.parse`. Si el
parseo falla por cualquier motivo, el veredicto cae a `escalate: true, priority: high`: un
pipeline de triage roto **siempre llega a un humano** en lugar de auto-resolverse en silencio.
Además construye ambos textos de notificación (`alertText` y `resolvedText`); el gateway decide
cuál se envía.

### El gateway `conditional`

La condición es `{ variable: "results.decide.escalate", comparator: "eq", value: "true" }`.
El lado izquierdo se resuelve crudo (`resolvePathRaw`) y `eq` compara
`String(left) === String(right)`, así que el booleano que devuelve `decide` coincide con el
string `"true"`. A diferencia de `branch` (que ejecuta todas las ramas en paralelo),
`conditional` ejecuta **solo la primera rama que coincide** (o `default`) y expone
`{ matchedBranch }` en el resultado.

### Provisionamiento (`setup.sh`, 7 etapas idempotentes)

```
0/7 preflight        verifica el código JS embebido y la API key del proveedor
2/7 CRM hosteado     client.registry.services create/update + espera de Knative Ready
3/7 connector LLM    crea o reutiliza 'sample-<provider>-llm' (compartido con otros samples)
4/7 agente           upsert + publish de 'ai-sample-supervisor' (temperature 0.1)
5/7 telegram + chat  auto-descubre el chat_id del supervisor; asegura la instancia HTTP
6/7 workflow         ensamblado vía client.workflows, serviceId resuelto al UUID del registry
7/7 resumen          imprime la URL de ingest y el channel token
```

Reejecutar reutiliza todo por nombre; `RECREATE=1` borra y reconstruye servicio, agente,
instancia HTTP y workflow.

## Qué demuestra técnicamente

| Aspecto | Feature de la plataforma | Fuente del contrato (del README en inglés) |
| --- | --- | --- |
| Formas de las acciones | `ServiceCallArgs`, `ConditionalAction`, `AgentCallArgs` | `packages/shared/src/workflow.interfaces.ts` |
| Ejecución del gateway | `conditional`: primera coincidencia gana, `eq` compara strings | `services/workflow-service/src/temporal/workflows.ts` (`case "conditional"`) |
| Validación de acciones | `branches[]` con `label/condition/actions`, `default[]` opcional | `services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts` |
| Resultado del `agentCall` | `{ status, data: { reply, tool_calls }, headers }` → el veredicto vive en `results.triage.data.reply` | `services/workflow-service/src/temporal/activities/agent-call.activity.ts` |
| Resultado del `serviceCall` | `{ status, data, headers }` | `DOCS/workflows/patterns.md` + connector-runtime |
| Registro de hosted services | `POST /api/registry/services`, detalle con `knativeStatus.conditions[]` | `services/api-gateway/src/modules/registry/registry.controller.ts`, `services/registry-service/src/modules/services/services.service.ts` |
| CRUD del agente | AI > Agents (upsert + publish) | `services/api-gateway/src/modules/admin/admin-agents.controller.ts` |
| Ingest HTTP | `POST /api/webhooks/http/<tenant>/<externalId>` | `services/api-gateway/src/modules/channels/webhooks.controller.ts` |

## Cómo ejecutarlo y qué esperar

### Prerrequisitos

1. **Una cuenta de canal Telegram** con bot token real, y haber hecho `/start` al bot (el chat
   del supervisor se descubre desde los mensajes recientes del bot, igual que en `http-bridge`):
   ```bash
   (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-…" ./setup.sh)
   ```
2. **Una API key de proveedor LLM** (por defecto `OPENAI_API_KEY`) en `.env` — el agente de
   triage usa un LLM real en línea.
3. **Un cluster con `registry-service` + Knative** — el CRM simulado es un hosted service.

### Comandos

```bash
cd sdk/samples/ai-call-center-supervisor
cp .env.example .env   # completar OPENAI_API_KEY; opcionalmente fijar TELEGRAM_CHAT_ID
./setup.sh
./run.sh
```

### Salida esperada

`run.sh` verifica el workflow, resuelve el `appSecret` de la instancia y publica dos mensajes
contrastantes. El ingest siempre responde `{"status":"accepted"}` — el resultado llega a
Telegram, nunca en la respuesta HTTP:

1. **Mensaje enojado** (`cust-1001`): tras unos segundos de LLM, el bot envía al chat del
   supervisor un 🚨 SUPERVISOR ESCALATION con cliente, mensaje, prioridad, motivo y respuesta
   sugerida (verificado en vivo: matchedBranch "Escalate to supervisor").
2. **Mensaje calmo** (`cust-2002`): el bot envía un ✅ AUTO-RESOLVED con la respuesta sugerida
   (verificado en vivo: rama default).

## Detalles y advertencias

- **Cold start de Knative.** Con `CRM_MIN_SCALE=0`, el primer `serviceCall` puede tener que
  levantar el pod desde cero. `setup.sh` espera `Ready` hasta `CRM_READY_TIMEOUT_S` (120 s por
  defecto) pero el timeout solo advierte; sumado a los segundos del LLM, el primer mensaje
  puede demorar notablemente más que los siguientes.
- **`serviceId` es el UUID, nunca el slug.** Si se arma el workflow a mano, resolver primero el
  id del registry; el nombre del servicio no funciona como `serviceId`.
- **No "arreglar" el router con un `branch`.** `conditional` ejecuta una sola rama;
  `branch` las ejecuta todas en paralelo — se recibirían ambas notificaciones en cada mensaje.
- **`conversationId` fijo.** El paso `triage` usa siempre `ai-call-center-supervisor` como
  `conversationId`, así que todos los clientes de prueba comparten un mismo hilo de
  conversación con el agente. Una integración real debería derivarlo por cliente (por ejemplo
  desde `request.from`).
- **El connector LLM se comparte.** `sample-<provider>-llm` es el mismo nombre por defecto que
  usa `ai-agent-playground`; re-ejecutar cualquiera de los dos actualiza la clave/baseUrl en el
  mismo registro.
- **Anclaje del trigger.** `SUPERVISOR_PIN=1` (por defecto) fija `config.accountIds` a la
  instancia HTTP propia del sample para que ningún otro workflow HTTP se dispare cruzado. Si se
  recrea la instancia y un workflow viejo conserva el account id anterior, queda un anclaje
  obsoleto — re-ejecutar `setup.sh` lo recablea.
- **Descubrimiento del chat de Telegram.** El proceso limpia y restaura el webhook del bot, y
  los `/start` ya consumidos por el webhook no se reenvían — enviar `/start` de nuevo cuando el
  script lo pida. La lista completa de gotchas está en
  [`http-bridge/README.md`](../http-bridge/README.md#design-notes--gotchas).
- **No llega nada a Telegram** → revisar las ejecuciones del workflow en la admin console y que
  el servicio Knative `sample-crm` pueda arrancar desde cero.
