# ai-agent-triage — documentación funcional (ES)

> Documento funcional en español. Para la referencia técnica completa, consulte [README.md](README.md).

## ¿Qué hace este sample?

Este sample construye un **clasificador de triage de call center dentro de un workflow**: cada mensaje de cliente que llega a una instancia de canal HTTP dedicada es clasificado por un agente de IA publicado (acción `agentCall`) en intención / sentimiento / prioridad / resumen de una línea; la respuesta JSON del agente es parseada por una `jsFunction`, y un gateway exclusivo `conditional` enruta hacia una alerta de escalamiento 🚨 o un resumen de triage ✅ enviado por Telegram (`channelSend`).

Es el primer sample que demuestra la acción de workflow **`agentCall`** y el patrón canónico **parse-then-gate** (`jsFunction` + `conditional`). Conceptualmente es el hermano de [`http-bridge`](../http-bridge) (mismo transporte de entrada y misma ruta de notificación) con un LLM en el medio, construido sobre el contrato de aprovisionamiento de agentes de [`ai-agent-playground`](../ai-agent-playground).

**Verificado en vivo contra el clúster de desarrollo**: los tres samples corren con éxito; el ruteo condicional quedó probado (mensaje enojado → matchedBranch "Escalate" 🚨; neutro y positivo → rama default ✅) y el contrato JSON del agente se sostuvo con `gpt-4o-mini`.

## Escenario y caso de uso

Una empresa de telecomunicaciones recibe cientos de mensajes de clientes por hora a través de un canal de ingesta HTTP. Antes de que lleguen a un agente humano, cada mensaje debe clasificarse automáticamente: ¿es una queja urgente que requiere escalamiento inmediato, o una consulta rutinaria que puede esperar en la cola normal? El supervisor de turno quiere recibir en Telegram solo lo que importa, ya clasificado.

Sigamos un mensaje real por todo el pipeline. Un cliente escribe:

> "I want my money back RIGHT NOW. This is the THIRD time my order arrived broken and nobody answers my emails!"

1. El sistema del canal hace POST del mensaje a la URL de ingesta dedicada del sample. La respuesta HTTP es siempre `{"status":"accepted"}` — el procesamiento es asíncrono.
2. El trigger del workflow (fijado a esta instancia HTTP) dispara la ejecución.
3. El paso `triage` (`agentCall`) envía el texto al agente publicado `ai-sample-triage`, cuyo system prompt lo obliga a responder **solo** con JSON compacto:

   ```json
   {"intent": "refund", "sentiment": "negative", "priority": "urgent", "summary": "Customer demands an immediate refund after receiving a third broken order."}
   ```

4. El paso `route` (`jsFunction`) parsea ese JSON y deriva el veredicto: `priority` urgente/alta o `sentiment` negativo ⇒ `escalate: true`.
5. El gateway `notify` (`conditional`) evalúa `results.route.escalate eq "true"` → coincide la rama **Escalate**, y el supervisor recibe en Telegram:

   ```
   🚨 ESCALATION — priority: urgent | sentiment: negative | intent: refund
   Customer demands an immediate refund after receiving a third broken order.
   Original: I want my money back RIGHT NOW. This is the THIRD time my order arrived broken...
   ```

En cambio, una consulta tranquila ("Hi! Quick question — my order shipped on Monday, when should I expect it to arrive in Rosario?") o un agradecimiento se clasifican como neutral/positivo, no coinciden con ninguna rama y caen en la rama `default`:

```
✅ Triage — priority: normal | sentiment: neutral | intent: shipping
Customer asks when the order shipped on Monday will arrive in Rosario.
Original: Hi! Quick question — my order shipped on Monday...
```

El resultado: los humanos solo ven mensajes ya clasificados, y los urgentes llegan marcados como escalamiento sin intervención manual.

## Cómo funciona por dentro

### Qué aprovisiona setup.sh (5 etapas)

```
0/5 preflight   → valida jq/curl, el modo de credenciales y la API key del proveedor
1/5 login       → POST /api/auth/login → token Bearer (tenant acme)
2/5 connector   → connector con tag "llm" (reutiliza sample-<provider>-llm si ai-agent-playground ya lo creó)
3/5 agente      → upsert + publish de 'ai-sample-triage'; resuelve su UUID por nombre
4/5 resolución  → cuenta de Telegram + descubrimiento de chat_id + instancia HTTP dedicada
5/5 workflow    → POST /api/workflows con los ids resueltos ya embebidos en el cuerpo
```

- **El agente de triage** se crea con `temperature: 0.1` y `maxTokens: 200`: su único trabajo es una clasificación JSON compacta y determinística. El system prompt exige responder únicamente con un objeto JSON de una línea con exactamente las claves `intent`, `sentiment`, `priority`, `summary`, con valores acotados (`sentiment`: positive|neutral|negative; `priority`: low|normal|high|urgent). El agente **debe estar publicado** — los borradores no son ejecutables por el runtime.
- **La instancia HTTP dedicada** (`externalId = ai-agent-triage`) define la URL de ingesta `/api/webhooks/http/acme/ai-agent-triage`, autenticada con el header `x-http-channel-token: <appSecret>`. El trigger del workflow queda **fijado** (`config.accountIds: [<esta instancia>]`), de modo que solo los mensajes a esta URL disparan este workflow — sin interferencias con otros workflows HTTP del tenant (`TRIAGE_PIN=0` desactiva el pin).
- **El workflow** se arma con tres acciones encadenadas (anatomía parse-then-gate):

```
HTTP msg ─► trigger (message_received, channels:["http"], fijado a la instancia del sample)
              │
              ▼
            triage   agentCall — agentId: <UUID de ai-sample-triage>, message: {{request.text}};
                     la respuesta queda en results.triage.data.reply
              ▼
            route    jsFunction — quita code fences, hace JSON.parse (fail-safe: una
                     respuesta no parseable se escala), devuelve
                     { escalate, priority, sentiment, alertText, normalText }
              ▼
            notify   conditional — gateway exclusivo sobre results.route.escalate eq "true":
                       Escalate ─► channelSend telegram  "🚨 ESCALATION — ..."  (alertText)
                       default  ─► channelSend telegram  "✅ Triage — ..."      (normalText)
```

- **¿Por qué existe `route`?** Un `conditional` no puede parsear un *string* JSON: `IConditionRule.variable` es un dot-path que el motor recorre sobre objetos del contexto (`resolvePathRaw`). La `jsFunction` es parse-only: deriva el veredicto `escalate` pero **no decide el ruteo** — esa decisión pertenece al gateway. La condición `results.route.escalate eq "true"` funciona contra un booleano porque el motor compara `String(left) === String(right)`.
- **RECREATE=1 por defecto** para la instancia HTTP y el workflow: el cuerpo del workflow embebe el UUID del agente y los chat ids resueltos **en esta corrida**, así que reutilizar por nombre enmascararía cambios. El connector y el agente, en cambio, siempre se actualizan en el lugar.

### Flujo de un mensaje de punta a punta

```
Cliente HTTP ──POST──► api-gateway ──NATS (INGRESS-ACME)──► channel-service-worker
                                                                   │ evento http.received
                                                                   ▼
                                                            workflow-service ──gRPC──► Temporal
                                                                   │ worker workflow-orchestrator
                                        triage: agentCall ──NATS──► agent-ai-service ──HTTPS──► LLM (OpenAI)
                                                                   │ resultado por NATS/Redis
                                        route: jsFunction (local, en el propio worker)
                                        notify: conditional ──► channelSend ──NATS──► channel-service-worker
                                                                   │
                                                                   ▼
                                                       HTTPS api.telegram.org → Telegram del supervisor
```

A diferencia de `endpointCall`, la actividad `agentCall` corre **localmente en el worker `workflow-orchestrator`** (no hay salto por `connector-runtime`): hace de proxy de la ejecución del agente sobre NATS, espera el resultado (`executeAndWait`) y envía heartbeats a Temporal cada 15 s durante llamadas largas al LLM.

## Qué demuestra técnicamente

- **Acción `agentCall`**: `AgentCallArgs` (`packages/shared/src/workflow.interfaces.ts:156`) requiere `agentId` (UUID, no nombre) + `message`; `conversationId`/`userId`/`channel` son metadatos opcionales. La actividad (`services/workflow-service/src/temporal/activities/agent-call.activity.ts`) devuelve `{ status, data: { reply, tool_calls }, headers }` — por eso el texto del agente vive en `results.triage.data.reply`.
- **Patrón parse-then-gate**: `jsFunction` parse-only + `ConditionalAction` (`workflow.interfaces.ts:244`) con ramas evaluadas de arriba hacia abajo, primera coincidencia gana, `default` si ninguna coincide; el resultado expone `{ matchedBranch }`.
- **Trigger fijado a una instancia de canal**: `message_received` con `channels:["http"]` + `config.accountIds` — aislamiento por instancia dentro del tenant.
- **Diseño de prompt para salidas estructuradas**: contrato JSON estricto + temperatura baja + `maxTokens` pequeño, con defensa en el consumidor.
- **`channelSend` multi-destinatario**: `to` acepta un único string; con `TELEGRAM_CHAT_ID_2` cada brazo del gateway se convierte en un `branch` paralelo con un `channelSend` por chat.
- **Contratos verificados en código**: validador de acciones (`workflow-action.validator.ts`), ejecutor (`services/workflow-service/src/temporal/workflows.ts`), webhook HTTP (`services/api-gateway/src/modules/channels/webhooks.controller.ts`).

## Cómo ejecutarlo y qué esperar

Prerrequisitos (el script cablea connector + agente + instancia HTTP + workflow; el resto va aparte):

1. Una cuenta de canal de Telegram con bot token real: `(cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-..." ./setup.sh)`
2. Haber enviado `/start` al bot (el `TELEGRAM_CHAT_ID` se descubre automáticamente vía `getUpdates`, con la danza de limpiar/restaurar el webhook — o se fija por `.env`).
3. Una API key de LLM (por ejemplo `OPENAI_API_KEY`) en `.env`. El sample `http-connectors` **no** es necesario.

```bash
cd integrations/ai/ai-agent-triage
cp .env.example .env    # setear OPENAI_API_KEY
./setup.sh              # aprovisiona todo e imprime la URL de ingesta + token
./run.sh                # publica 3 mensajes de cliente de ejemplo
```

`run.sh` envía tres mensajes — una demanda de reembolso enojada, una consulta neutra de envío y un agradecimiento — y cada uno produce una notificación en Telegram. Resultado verificado en vivo:

| Mensaje | Clasificación | Rama | Notificación |
| --- | --- | --- | --- |
| "I want my money back RIGHT NOW..." | refund / negative / urgent | `matchedBranch: "Escalate"` | 🚨 ESCALATION |
| "when should I expect it to arrive in Rosario?" | shipping / neutral / normal | default | ✅ Triage |
| "the replacement arrived today... great support!" | compliment / positive / low | default | ✅ Triage |

También puede enviar mensajes manualmente (setup imprime la URL y el token exactos al final):

```bash
curl -X POST 'http://localhost:8080/api/webhooks/http/acme/ai-agent-triage' \
  -H 'content-type: application/json' \
  -H 'x-http-channel-token: <app-secret-impreso-por-setup>' \
  -d '{"from":"customer-42","text":"Where is my package? It was supposed to arrive yesterday."}'
```

Presupueste algunos segundos por mensaje: hay una llamada real a un LLM en el medio.

## Detalles y advertencias

- **La respuesta de ingesta es siempre `{"status":"accepted"}`.** El workflow corre de forma asíncrona; el resultado del triage llega por Telegram, nunca en la respuesta HTTP.
- **Escalamiento fail-safe**: si la respuesta del LLM no es JSON parseable (aun tras quitar code fences), el parser cae a `{intent:"unknown", sentiment:"neutral", priority:"high"}` con la respuesta cruda embebida en el resumen — un mal día del LLM degrada la notificación, nunca rompe el workflow. Una respuesta no parseable **se escala** por diseño.
- **`conversationId` fijo compartido**: el paso `triage` usa `conversationId: "ai-agent-triage"`, así que todos los clientes de prueba comparten un mismo hilo de conversación con el agente. Una integración real debería derivarlo por cliente (por ejemplo desde `request.from`).
- **`agentCall.args.variables` se sobrescribe en runtime**: el ejecutor pisa ese campo con las variables del contexto del workflow — todo lo que el agente necesita debe viajar en `message` (aquí: `{{request.text}}`).
- **`agentCall` es slow-path por diseño**: heartbeat a Temporal cada 15 s, espera de hasta `AGENT_CALL_TIMEOUT_MS` (15 min por defecto) y un circuit breaker por tenant/agente (10 fallos en 120 s lo abren — corridas repetidas contra una key rota empiezan a fallar rápido con `CIRCUIT_OPEN`).
- **Descubrimiento de chat de Telegram**: `getUpdates` y un webhook activo son mutuamente excluyentes en el mismo token, así que el descubrimiento limpia el webhook y lo restaura después (`TRIAGE_RESTORE_WEBHOOK=1`). Los `/start` enviados **antes** de la limpieza ya fueron consumidos por el webhook y no se reprocesan — envíe `/start` cuando el script lo pida. El `accessToken` del bot llega en texto plano desde la API de cuentas. Las advertencias completas están en el README de `http-bridge` (mismo código, variables `TRIAGE_*`).
- **Use `activity`, no `type`, para el tipo de acción** — vea `DOCS/workflows/patterns.md`. El único lugar donde aparece `type` es el objeto del trigger.
- **`channelSend.to` es un único string** — para múltiples destinatarios se necesita un `branch` con un brazo por chat; el sample lo hace automáticamente cuando existe `TELEGRAM_CHAT_ID_2`.
