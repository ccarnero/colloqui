# ai-system-variables — Documentación funcional (ES)

> Documento funcional en español. No es una traducción del `README.md`; explica qué hace el
> sample, cómo funciona por dentro y qué esperar al ejecutarlo. Para la referencia completa de
> contratos y troubleshooting en inglés, ver [`README.md`](README.md).

## ¿Qué hace este sample?

Demuestra las **System Variables** (admin console, AI > System Variables) como configuración
viva de la plataforma: un router de escalación con marca ("brand-stamped") donde el nombre de
la empresa, la política de ruteo y el tono de voz **no viven en el workflow ni en el prompt**,
sino en el store de variables del tenant. Estructuralmente es el pipeline de
[`ai-agent-triage`](../ai-agent-triage) (agentCall → jsFunction → conditional → channelSend),
pero cada literal con forma de marca o de política fue extraído hacia las variables:

| Variable | Valor inicial | Dónde se resuelve |
| --- | --- | --- |
| `companyName` | `Acme Telco` | En el texto del `channelSend` (templating de args de acciones) |
| `escalationPriority` | `high` | Como **lado derecho templado** de la regla del `conditional` |
| `brandVoice` | `warm and upbeat, always thanking the customer` | Dentro del `system_prompt` del agente, vía `agentCall` |

## Escenario y caso de uso

El equipo de **operaciones** de Acme Telco necesita ajustar el comportamiento del contact
center sin abrir tickets a ingeniería. Hoy la regla es "escala todo lo clasificado `high`";
mañana hay una tormenta de reclamos y solo debe escalar lo `urgent`. La semana próxima la
empresa se rebrandea a "Globex" y el tono pasa de cálido a formal. En un diseño tradicional,
cada uno de esos cambios es una edición de workflow o de prompt y un redeploy.

Aquí no: **la política de ruteo es un dato, no código.** El equipo de operaciones hace un
`PATCH` sobre la variable y el mismo workflow, sin editarlo, re-rutea, re-marca y re-entona
todas las notificaciones siguientes. Dos conversaciones reales (ejecutadas y verificadas
contra el cluster de desarrollo):

| # | Cliente | Mensaje | Clasificación del agente | Resultado observado |
| --- | --- | --- | --- | --- |
| 1 | `furious-customer` | "This is the THIRD time my internet goes down this week… Fix it TODAY or I am cancelling everything!" | `priority: "high"` (= valor actual de `escalationPriority`) | matchedBranch **"Escalate"** → 🚨 `[Acme Telco] escalation — priority: high` + resumen en la voz de marca |
| 2 | `calm-customer` | "Hi! Quick question — does my plan include roaming in Uruguay? No rush, thanks!" | `priority: "low"` | rama **default** → ✅ `[Acme Telco] handled — priority: low` + resumen en la voz de marca |

Ambas notificaciones llegaron a Telegram con valores limpios (sin comillas espurias); ver la
advertencia sobre el bug de doble encoding jsonb más abajo.

## Cómo funciona por dentro

### Anatomía del workflow

```
HTTP msg ─► trigger (message_received, channels:["http"], anclado a la instancia del sample)
              │
              ▼
            triage    agentCall — agentId: <ai-sample-sysvars>, message: {{request.text}};
                      el system_prompt del agente embebe {{variables.system.brandVoice}}
                      y {{variables.system.companyName}} — los resuelve agent-ai-service
                      en tiempo de ejecución; el agente responde SOLO JSON estricto
                      {"priority":"low|normal|high|urgent","summary":"..."}
              ▼
            parse     jsFunction — limpia code fences, hace JSON.parse (fail-safe:
                      respuesta no parseable → priority "high"); devuelve SOLO
                      { priority, summary } — parsea, no decide el ruteo
              ▼
            notify    conditional — gateway exclusivo cuyo LADO DERECHO es una variable:
                        { variable: "results.parse.priority", comparator: "eq",
                          value: "{{variables.system.escalationPriority}}" }
                        match   ─► channelSend telegram "🚨 [{{variables.system.companyName}}] escalation — …"
                        default ─► channelSend telegram "✅ [{{variables.system.companyName}}] handled — …"
```

### Los TRES puntos de resolución (verificados)

Al arrancar cada ejecución, workflow-service carga las variables activas del tenant
(`system-variables.provider.ts`, caché de 5 minutos por tenant) y las sienta en
`context.variables.system`. Desde ahí se resuelven en tres lugares distintos:

1. **Args de acciones.** `resolveTemplates` recorre todos los args: el
   `{{variables.system.companyName}}` dentro del `text` del `channelSend` se resuelve como
   cualquier otro path del contexto. Cada notificación sale estampada `[Acme Telco]`.
2. **`condition.value` del `conditional`.** El lado izquierdo (`condition.variable`) es un
   dot-path crudo (`resolvePathRaw`); el lado derecho (`condition.value`) **también pasa por
   `resolveTemplates`** antes de la comparación `String(left) === String(right)`. Por eso
   `value: "{{variables.system.escalationPriority}}"` funciona como regla: la política de
   ruteo vive en la base de datos, no en la definición del workflow.
3. **`system_prompt` del agente.** El prompt de `ai-sample-sysvars` se guarda con los
   placeholders `{{variables.system.brandVoice}}` y `{{variables.system.companyName}}` en
   crudo. Cuando el workflow invoca al agente con `agentCall`, la actividad reenvía
   `context.variables` (pisando cualquier `args.variables` de la definición — aquí eso es la
   feature, no un gotcha) y el template renderer de agent-ai-service — que tiene `variables`
   en la whitelist de namespaces de prompt — los resuelve por ejecución.

### El playground NO resuelve variables

El payload de `variables` llega a agent-ai-service **únicamente** a través del `agentCall` del
workflow. agent-ai-service nunca consulta el store de variables por sí mismo: hablar con
`ai-sample-sysvars` en el playground de la admin console o por chat directo no envía
variables, y el renderer deja `{{variables.system.brandVoice}}` textual (con un warning).
La voz de marca se prueba a través del workflow, no del playground.

### Provisionamiento (`setup.sh`, 6 etapas idempotentes)

```
0/6 preflight        valida el modo de credencial y la API key del proveedor
                     (login queda a cargo de @yoizen/platform-sdk, de forma transparente)
2/6 variables        upsert por nombre de companyName, escalationPriority y brandVoice
                     (los valores existentes se PRESERVAN salvo SYSVARS_RESET=1)
3/6 connector LLM    crea o reutiliza 'sample-<provider>-llm' (compartido con otros samples de IA)
4/6 agente           upsert + publish de 'ai-sample-sysvars' (temperature 0.1, JSON estricto)
5/6 telegram + HTTP  resuelve la cuenta Telegram, descubre el chat_id, asegura la instancia
6/6 workflow         gateway con condition.value = "{{variables.system.escalationPriority}}"
```

Provisionado por `src/setup.ts` a través de `@yoizen/platform-sdk` (`systemVariables`, `connectors`,
`agents`, `channels`, `workflows`); `setup.sh` solo resuelve el entorno dev y ejecuta el script Node.

Nota: a diferencia de otros samples, `RECREATE` es `1` por defecto — la instancia HTTP y el
workflow se reconstruyen en cada corrida (embeben el agent id y el chat id recién resueltos);
variables, connector y agente se upsertean en el lugar de todas formas.

## Qué demuestra técnicamente

| Aspecto | Feature de la plataforma | Fuente del contrato (del README en inglés) |
| --- | --- | --- |
| CRUD de variables | `GET/POST /api/admin/system-variables`, `PATCH/DELETE /:id` | `services/api-gateway/src/modules/admin/admin-system-variables.controller.ts` |
| DTO de la variable | `name`, `type ∈ [string,number,boolean,json,array,secret]`, `value`, `label?`, `description?` — únicas por (tenant, name) | `services/agent-admin-service/src/modules/system-variables/system-variables.dto.ts` |
| Carga en runtime + caché | carga por tenant al inicio de la ejecución, TTL de 5 minutos, fail-open | `services/workflow-service/src/modules/workflows/workflows.service.ts:322-337`, `system-variables.provider.ts:30-52`, `temporal/workflows.ts:370-390` |
| Templating de args | `resolveTemplates` sobre todos los args de acciones | `services/workflow-service/src/temporal/workflows.ts` |
| `condition.value` templado | el lado derecho del `conditional` también se resuelve como template | `temporal/workflows.ts:343-346`, `packages/shared/src/workflow.interfaces.ts:229` |
| Variables en el prompt | namespace `variables` whitelisted en el renderer de prompts | `services/agent-ai-service/src/modules/template-renderer/template-renderer.service.ts` |
| Normalización jsonb | `normalizeJsonbValue` evita el doble encoding de strings | `services/workflow-service/src/modules/workflows/system-variables.provider.ts` |
| CRUD + publish del agente | AI > Agents | `services/api-gateway/src/modules/admin/admin-agents.controller.ts` |
| Ingest HTTP | `POST /api/webhooks/http/<tenant>/<externalId>` | `services/api-gateway/src/modules/channels/webhooks.controller.ts` |

## Cómo ejecutarlo y qué esperar

### Prerrequisitos

1. **Una cuenta de canal Telegram** con bot token real, y haber hecho `/start` al bot
   (`TELEGRAM_CHAT_ID` se auto-descubre solo cuando está sin definir):
   ```bash
   (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-…" ./setup.sh)
   ```
2. **Una API key de proveedor LLM** (por ejemplo `OPENAI_API_KEY`) en `.env`. El sample
   `http-connectors` no hace falta: este mismo setup crea el connector.

### Comandos

```bash
cd integrations/ai/ai-system-variables
cp .env.example .env   # completar OPENAI_API_KEY (u otra clave de proveedor)
./setup.sh
./run.sh
```

### Salida esperada

`run.sh` imprime primero los valores **actuales** de las tres variables (ellas *son* la
configuración) y luego publica dos mensajes. Verificado en el cluster de desarrollo: el
mensaje furioso se clasificó `high` y tomó la rama "Escalate" (🚨), el calmo tomó la rama
default (✅), ambos con valores limpios:

```
🚨 [Acme Telco] escalation — priority: high
<resumen en la voz de marca>
Original: This is the THIRD time my internet goes down this week…
```

Después, el flip en vivo — sin editar el workflow, sin redeploy (`run.sh` imprime el comando
con el id real de la variable):

```bash
curl -X PATCH "$YOIZEN_BASE_URL/api/admin/system-variables/<escalationPriority-id>" \
  -H "Host: $YOIZEN_HOST_HEADER" -H "x-yoizen-tenant: $YOIZEN_TENANT" \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"value":"urgent"}'
# esperar hasta 5 min (caché por tenant) y re-ejecutar ./run.sh:
# el mensaje furioso ("high") ahora toma la rama ✅ default — solo "urgent" escala.
```

El rebranding funciona igual: `PATCH` de `companyName` a `"Globex"` y de `brandVoice` a
`"terse and formal"` cambia, tenant-wide, el sello de las notificaciones y el estilo de
escritura del agente.

## Detalles y advertencias

- **El bug de doble encoding jsonb (corregido — imprescindible para este sample).** El
  comportamiento correcto verificado arriba requirió arreglar un doble encoding en
  `services/workflow-service/src/modules/workflows/system-variables.provider.ts`
  (`normalizeJsonbValue`): el `value` se guarda como jsonb y, sin la normalización, una
  variable `string` llegaba al runtime con comillas literales (`"high"` en vez de `high`),
  con lo que el `conditional` nunca coincidía y todo caía en la rama default. Si en un
  despliegue las notificaciones muestran valores entrecomillados, ese fix falta.
- **La caché de 5 minutos es el precio de "en vivo".** workflow-service carga las variables
  del tenant una vez cada 5 minutos (`TTL_MS = 5 * 60 * 1000`). Tras un `PATCH`, las
  ejecuciones siguen usando los valores viejos hasta que la entrada expira — presupuestar
  hasta 5 minutos antes de demostrar el flip. No hay endpoint de invalidación.
- **La carga es fail-open.** Si la consulta de variables falla, el workflow corre igual con
  `variables.system` vacío; los templates `{{variables.system.X}}` no resolubles degradan a
  vacío/textual en lugar de romper la ejecución — un nombre mal escrito falla en silencio.
- **`type: "secret"` no se enmascara en runtime.** El loader selecciona `name, value` sin
  tratamiento especial: una variable secreta se resuelve en texto plano en cualquier
  `{{variables.system.X}}` — incluso en el texto enviado a Telegram. No poner credenciales
  reales esperando enmascaramiento.
- **El upsert respeta las ediciones en vivo.** `setup.sh` crea las variables que faltan pero
  nunca pisa un valor existente (salvo `SYSVARS_RESET=1`): un flip de política sobrevive a una
  re-ejecución del setup. DELETE es soft delete (`is_active=false`).
- **`parse` solo parsea.** Devuelve `{ priority, summary }` y no toma decisión de ruteo — la
  política vive en el lado derecho del gateway. Su única opinión es el fail-safe: una
  respuesta no parseable se vuelve `"high"`, que escala con la política por defecto pero
  (deliberadamente) NO después de flipearla a `"urgent"` — el valor fail-safe y el valor de
  política son perillas independientes.
- **`conversationId` fijo.** El `agentCall` usa siempre `ai-system-variables` como
  `conversationId`; todos los clientes de prueba comparten un hilo. Una integración real
  debería derivarlo por cliente.
- **Gotchas de Telegram heredados de `http-bridge`** (limpieza/restauración del webhook, los
  `/start` previos no se reenvían, `accessToken` en texto plano) — pero solo cuando
  `TELEGRAM_CHAT_ID` no está definido; un valor preseteado saltea el descubrimiento.
- **El ingest siempre responde `{"status":"accepted"}`.** El workflow corre en asíncrono; el
  resultado llega a Telegram, no en la respuesta HTTP. Contar unos segundos por mensaje por el
  salto al LLM.
