# REVIEW.md — Muestra dorada post-fix de correlación (2026-07-09)

**Alcance:** 72 eventos NATS capturados en vivo el 2026-07-09 entre las 21:04 y las 21:20 (streams `INGRESS-ACME` seq 1242–1311 y `GATEWAY_AUDIT`, tenant `acme`), DESPUÉS de desplegar los fixes de correlación 1, 2 y 4 (`workflow-service` y `agent-memory-service`). La muestra pre-fix fue descartada tras la verificación; sus hallazgos quedan registrados en `DRIFT.md`.

**Cómo leer:** igual que la revisión anterior — cada evento lleva etiqueta (`tech`/`business_fn`/`is_claim_check`), regla de `TAXONOMY.md` §4, EVIDENCIA citada (campo del payload crudo o código publicador) y CONFIANZA. Sin cita no vale. Ninguna regla fue agregada ni reinterpretada.

**Resultado central de esta pasada:** las 4 cadenas de conversación y los 2 ciclos de memoria **cierran formalmente** por `correlation_id` + `causation_id` — ya no hace falta ninguna hipótesis por cercanía temporal para armar las historias (en la muestra pre-fix, 10 eventos quedaban huérfanos y las ejecuciones de agente usaban literales estáticos como correlación). La evidencia por cadena está en cada tabla.

`is_claim_check` es `false` en los 72 eventos (ninguno tiene `payload_inline === false`; los 24 heartbeats no traen el campo).

---

## 1. Historias por cadena de correlación

### 1.1 Telegram — "ping" de Christian (raíz `07102a98`, 11 eventos, seq 1242–1254)

**LA HISTORIA:** Christian le escribió "ping" al bot de Telegram. Como siempre, recibió dos respuestas por dos caminos: el eco automático del workflow y la aclaración del bot de soporte del repo de que solo responde preguntas sobre `vercel/next.js`. La diferencia con la muestra anterior: ahora TODOS los pasos —incluida la ejecución del agente de IA y los cierres de workflow— comparten el mismo `correlation_id`.

**CIERRE DE CADENA: SÍ, VERIFICADO.** Los 11 eventos llevan `correlation_id = 07102a98-5185-40b7-85e8-3a60d23fd096` (el id del webhook raíz, seq1242), y cada `causation_id` apunta a un evento presente en la muestra. Cero hipótesis.

| Hora | Subject (seq) | Rol | Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|---|---|---|
| 21:05:52.106 | `api-gateway...telegram.webhook.webhook_received.v1` (1242) | Llega el "ping" crudo | telegram / ingress | 2 | `payload.message.text="ping"`, `correlation_id` = id propio, `causation_id=null`, depth 0 — raíz legítima | ALTA |
| 21:05:52.121 | `channel-service...telegram.received.v1` (1243) | Verificación y resolución de cuenta | telegram / channel-processing | 3 | `causation_id="07102a98..."` = seq1242, depth 1 | ALTA |
| 21:05:52.785 | `channel-service...telegram.send.v1` (1244) | Eco automático del workflow | telegram / channel-egress | 4 | `payload.text="Echo: ping..."`, `causation_id="208e49bf..."` = seq1243, depth 2. Residual esperado (fix 3 diferido): la causación apunta al `received`, no a la ejecución que generó el texto | ALTA |
| 21:05:52.795 | `ai-agent-gateway...execution_requested.v1` (1245) | Se pide evaluar si "ping" es sobre el repo | platform / agent-execution | 6 | **POST-FIX:** `correlation_id="07102a98..."` (raíz heredada — antes era el literal "mcp-repo-support-bot"), `causation_id="208e49bf..."` = seq1243, depth 2 | ALTA |
| 21:05:52.808 | `...execution_started.v1` (1246) | Arranca la ejecución | platform / agent-execution | 6 | `causation_id="e231584a..."` = seq1245, depth 3, correlación heredada | ALTA |
| 21:05:52.835 | `workflow-service...execution_completed.v1` (1247) | `telegram-transform-reply` reporta fin | unknown / unknown | 17 | **POST-FIX:** `correlation_id="07102a98..."`, `causation_id="208e49bf..."` = seq1243, depth 2 (antes: huérfano autocorrelacionado). `payload.workflowName="telegram-transform-reply"` | ALTA |
| 21:05:53.992 | `...telegram.sent.v1` (1248) | Confirmación de entrega del eco | telegram / channel-egress | 4 | `causation_id="8f8448b2..."` = seq1244, depth 3 | ALTA |
| 21:06:01.288 | `...execution_completed.v1` (1251) | El bot concluye `{"about_repo": false}` | platform / agent-execution | 6 | `payload.response='{"about_repo": false}'`, `causation_id="e231584a..."` = seq1245, depth 3, correlación heredada | ALTA |
| 21:06:01.369 | `...telegram.send.v1` (1252) | Respuesta del bot ("solo respondo sobre vercel/next.js") | telegram / channel-egress | 4 | `payload.text="I only answer questions about the vercel/next.js repository..."`, `causation_id="208e49bf..."` = seq1243 — residual esperado (fix 3): salta la ejecución del agente | ALTA |
| 21:06:01.400 | `workflow-service...execution_completed.v1` (1253) | `mcp-repo-support-bot` reporta fin | unknown / unknown | 17 | `payload.workflowName="mcp-repo-support-bot"`, `correlation_id="07102a98..."`, `causation_id="208e49bf..."` | ALTA |
| 21:06:01.745 | `...telegram.sent.v1` (1254) | Confirmación de entrega de la respuesta del bot | telegram / channel-egress | 4 | `causation_id="9952072a..."` = seq1252, depth 3 | ALTA |

**Memoria asociada:** seq1250 (`memory_proposed`, memoria `0755b1c8`, contenido `{"about_repo": false}`) sale de la sesión de esta ejecución (`metadata.sessionId="chat-eb0db541...-1783631153856"`) pero sigue siendo raíz del ciclo de memoria (`causation_id=null` por diseño — el fix 4 ancló published/rejected a proposed, no proposed a la ejecución). Ver §2.2.

### 1.2 HTTP — cliente enojado, escalamiento (raíz `583625a7`, 9 eventos, seq 1257–1266)

**LA HISTORIA:** El "angry-customer" exige el reembolso por tercera vez. El agente de triage lo clasifica reembolso/negativo/alta prioridad y el sistema manda el aviso de escalamiento por Telegram a la cuenta de operaciones.

**CIERRE DE CADENA: SÍ, VERIFICADO.** Los 9 eventos llevan `correlation_id = 583625a7-8eb0-4189-a68b-b597eaff69c4`.

| Hora | Subject (seq) | Rol | Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|---|---|---|
| 21:06:34.232 | `api-gateway...http.webhook.webhook_received.v1` (1257) | Llega el reclamo crudo | http-generic / ingress | 2 | `payload.text="I want my money back RIGHT NOW..."`, raíz (correlación = id propio, causación null) | ALTA |
| 21:06:34.237 | `channel-service...http.received.v1` (1258) | Verificación, cuenta HTTP `953c1f5d...` | http-generic / channel-processing | 3 | `causation_id="583625a7..."` = seq1257, depth 1, `envelope.accountid="953c1f5d..."` | ALTA |
| 21:06:34.348 | `...execution_requested.v1` (1259) | Se pide clasificar el reclamo | platform / agent-execution | 6 | **POST-FIX:** `correlation_id="583625a7..."` (antes literal "ai-agent-triage"), `causation_id="2f5c191f..."` = seq1258, depth 2, `payload.input.message="I want my money back..."` | ALTA |
| 21:06:34.350 | `...execution_started.v1` (1260) | Arranca | platform / agent-execution | 6 | `causation_id="75279ab1..."` = seq1259, depth 3 | ALTA |
| 21:06:34.367 | `workflow-service...execution_completed.v1` (1261) | `e2e-http-log` registra la llegada | unknown / unknown | 17 | **POST-FIX:** `correlation_id="583625a7..."`, `causation_id="2f5c191f..."`, `payload.workflowName="e2e-http-log"` | ALTA |
| 21:06:36.290 | `...execution_completed.v1` (1263) | Clasificación: reembolso/negativo/alta | platform / agent-execution | 6 | `payload.response='{"intent":"refund","sentiment":"negative","priority":"high",...}'`, `causation_id="75279ab1..."` = seq1259 | ALTA |
| 21:06:36.371 | `...telegram.send.v1` (1264) | Aviso de escalamiento por Telegram (cuenta `0805f09d...`) | telegram / channel-egress | 4 | `payload.text="🚨 ESCALATION — priority: high..."`, `causation_id="2f5c191f..."` = seq1258 — residual fix 3 | ALTA |
| 21:06:36.408 | `workflow-service...execution_completed.v1` (1265) | `ai-agent-triage` reporta fin | unknown / unknown | 17 | `payload.workflowName="ai-agent-triage"`, `correlation_id="583625a7..."`, `causation_id="2f5c191f..."` | ALTA |
| 21:06:36.779 | `...telegram.sent.v1` (1266) | Confirmación de entrega | telegram / channel-egress | 4 | `causation_id="2d76b484..."` = seq1264, depth 3 | ALTA |

**Memoria asociada:** seq1262 (memoria `20205190`, contenido = el resumen del triage de reembolso; `metadata.sessionId` de la ejecución `019f48b4-28a7`). Raíz de memoria por diseño.

### 1.3 HTTP — cliente con duda de envío (raíz `049662ce`, 9 eventos, seq 1268–1282)

**LA HISTORIA:** El "curious-customer" pregunta cuándo llega su pedido a Rosario. Triage: pregunta/neutral/normal; resumen enviado por Telegram.

**CIERRE DE CADENA: SÍ, VERIFICADO.** 9 eventos con `correlation_id = 049662ce-1986-4894-b8bd-71565252dde3`; se intercala temporalmente con la cadena 1.4 sin mezclarse (la correlación separa perfectamente ambas — exactamente lo que el fix habilita).

| Hora | Subject (seq) | Rol | Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|---|---|---|
| 21:06:41.245 | `webhook_received.v1` (1268) | Llega la consulta | http-generic / ingress | 2 | `payload.text="Hi! Quick question — my order shipped on Monday..."`, raíz | ALTA |
| 21:06:41.249 | `http.received.v1` (1269) | Verificación | http-generic / channel-processing | 3 | `causation_id="049662ce..."` = seq1268, depth 1 | ALTA |
| 21:06:41.319 | `execution_requested.v1` (1270) | Se pide clasificar | platform / agent-execution | 6 | **POST-FIX:** correlación heredada, `causation_id="c29961e5..."` = seq1269, depth 2 | ALTA |
| 21:06:41.321 | `execution_started.v1` (1271) | Arranca | platform / agent-execution | 6 | `causation_id="30a4f92d..."` = seq1270, depth 3 | ALTA |
| 21:06:41.332 | `workflow...execution_completed.v1` (1272) | `e2e-http-log` | unknown / unknown | 17 | `payload.workflowName="e2e-http-log"`, correlación y causación heredadas | ALTA |
| 21:06:43.975 | `execution_completed.v1` (1278) | Clasificación: pregunta/neutral/normal | platform / agent-execution | 6 | `payload.response='{"intent":"question",...}'`, `causation_id="30a4f92d..."` = seq1270 | ALTA |
| 21:06:44.058 | `telegram.send.v1` (1280) | Resumen por Telegram | telegram / channel-egress | 4 | `payload.text="✅ Triage — priority: normal..."`, `causation_id="c29961e5..."` = seq1269 — residual fix 3 | ALTA |
| 21:06:44.098 | `workflow...execution_completed.v1` (1281) | `ai-agent-triage` reporta fin | unknown / unknown | 17 | `payload.workflowName="ai-agent-triage"`, correlación heredada | ALTA |
| 21:06:44.483 | `telegram.sent.v1` (1282) | Confirmación de entrega | telegram / channel-egress | 4 | `causation_id="7fe85e26..."` = seq1280 | ALTA |

**Memoria asociada:** seq1277 (memoria `32eab64d`, resumen de la pregunta de envío, sesión `019f48b4-43f1`).

### 1.4 HTTP — cliente agradecido (raíz `8c0576be`, 9 eventos, seq 1273–1287)

**LA HISTORIA:** El "happy-customer" agradece porque el repuesto llegó bien. Triage: elogio/positivo/baja; resumen por Telegram. (Nota: esta vez el agente clasificó `intent:"compliment"`, no `"thank_you"` como en la muestra pre-fix — misma entrada, salida LLM distinta; no afecta ninguna etiqueta.)

**CIERRE DE CADENA: SÍ, VERIFICADO.** 9 eventos con `correlation_id = 8c0576be-f9d1-48c7-a3e9-1e5c72b48ac2`.

| Hora | Subject (seq) | Rol | Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|---|---|---|
| 21:06:43.257 | `webhook_received.v1` (1273) | Llega el agradecimiento | http-generic / ingress | 2 | `payload.text="Just wanted to say the replacement arrived today..."`, raíz | ALTA |
| 21:06:43.261 | `http.received.v1` (1274) | Verificación | http-generic / channel-processing | 3 | `causation_id="8c0576be..."` = seq1273, depth 1 | ALTA |
| 21:06:43.337 | `execution_requested.v1` (1275) | Se pide clasificar | platform / agent-execution | 6 | **POST-FIX:** correlación heredada, `causation_id="92e34779..."` = seq1274, depth 2 | ALTA |
| 21:06:43.356 | `workflow...execution_completed.v1` (1276) | `e2e-http-log` | unknown / unknown | 17 | `payload.workflowName="e2e-http-log"`, correlación heredada | ALTA |
| 21:06:43.976 | `execution_started.v1` (1279) | Arranca | platform / agent-execution | 6 | `causation_id="881c3d46..."` = seq1275, depth 3 | ALTA |
| 21:06:46.962 | `execution_completed.v1` (1284) | Clasificación: elogio/positivo/baja | platform / agent-execution | 6 | `payload.response='{"intent":"compliment",...}'`, `causation_id="881c3d46..."` = seq1275 | ALTA |
| 21:06:47.106 | `telegram.send.v1` (1285) | Resumen por Telegram | telegram / channel-egress | 4 | `payload.text="✅ Triage — priority: low..."`, `causation_id="92e34779..."` = seq1274 — residual fix 3 | ALTA |
| 21:06:47.142 | `workflow...execution_completed.v1` (1286) | `ai-agent-triage` reporta fin | unknown / unknown | 17 | `payload.workflowName="ai-agent-triage"`, correlación heredada | ALTA |
| 21:06:47.478 | `telegram.sent.v1` (1287) | Confirmación de entrega | telegram / channel-egress | 4 | `causation_id="5e624a90..."` = seq1285 | ALTA |

**Memoria asociada:** seq1283 (memoria `5366c0d3`, resumen del elogio, sesión `019f48b4-4bd9`).

### 1.5 Ciclo de memoria — validación A: proposed → published (seq 1308 → 1310)

**LA HISTORIA:** Memoria de PRUEBA creada deliberadamente por el equipo para validar el anclaje de causación del fix 4 (**procedencia de test**, no tráfico de negocio): se propone una memoria de tenant y un operador la aprueba ~9 segundos después.

**CIERRE DE CADENA: SÍ, VERIFICADO — esta es la validación directa del fix 4.**

| Hora | Subject (seq) | Rol | Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|---|---|---|
| 21:19:13.690 | `memory_proposed.v1` (1308) | Se propone la memoria de prueba A | platform / agent-memory | 9 | `payload.content="Temporary test memory to validate causation anchoring. Safe to delete."`, `payload.status="PROPOSED"`, `correlation_id="memory:bb0135b3..."`, causación null (raíz del ciclo, por diseño) | ALTA |
| 21:19:22.931 | `memory_published.v1` (1310) | Un operador la aprueba | platform / agent-memory | 9 | **POST-FIX:** `causation_id="332d969f..."` = el id del sobre de seq1308 (antes era null hardcodeado en `nats.provider.ts:397`), `correlation_id="memory:bb0135b3..."` compartido, `transport.depth=1` | ALTA |

### 1.6 Ciclo de memoria — validación B: proposed → rejected (seq 1309 → 1311)

**LA HISTORIA:** Segunda memoria de PRUEBA (**procedencia de test**), rechazada en vez de aprobada, para validar la otra rama del fix.

**CIERRE DE CADENA: SÍ, VERIFICADO.**

| Hora | Subject (seq) | Rol | Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|---|---|---|
| 21:19:13.788 | `memory_proposed.v1` (1309) | Se propone la memoria de prueba B | platform / agent-memory | 9 | mismo marcador de contenido de test, `correlation_id="memory:da052291..."`, causación null (raíz) | ALTA |
| 21:19:22.967 | `memory_rejected.v1` (1311) | Se rechaza | platform / agent-memory | 9 | **POST-FIX:** `causation_id="5c491be7..."` = el id del sobre de seq1309, `correlation_id="memory:da052291..."`, depth 1 | ALTA |

---

## 2. Eventos fuera de las cadenas, por familia (30 eventos)

### 2.1 Heartbeats `online.v1` (24 eventos)

seq1249, 1255, 1256, 1267, 1288–1307 — pulso de salud de `agent-ai-service` cada ~15 s durante toda la ventana.

| Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|
| platform / **unknown** | 16 | Kind `online` no está en el enum de la regla 6 → cae a la regla 16 (catch-all, revisión manual). Sin cambios respecto de la muestra anterior: sin `data.payload_inline`, `transport={"name":"nats","version":"1.0"}`, `idempotencykey` UUID plano (ej. `"febf0e28..."`, seq1249), `producer="agent-ai-service"` vs token 3 del subject `ai-agent-gateway`. Los fixes de correlación no tocaron este productor — esperado | ALTA |

### 2.2 `memory_proposed` orgánicos (4 eventos: seq1250, 1262, 1277, 1283)

Memorias reales propuestas por los agentes durante las conversaciones de §1.1–1.4 (contenidos: `{"about_repo": false}` y los tres resúmenes de triage).

| Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|
| platform / agent-memory | 9 | Subject `...agent-memory-service.agent-memory.platform.internal.memory_proposed.v1`; correlación `memory:<memoryId>`; causación null — **raíz del ciclo de memoria por diseño del fix 4** (el fix ancló published/rejected → proposed; NO ancló proposed → ejecución del agente). Vínculo con su conversación: solo `metadata.agentId`/`sessionId` | ALTA |

**DRIFT #9 persiste (esperado):** los 8 eventos de memoria siguen con `envelope.producer="agent-admin-service"` y `envelope.domain="automation"` contra los tokens del subject (`agent-memory-service`/`agent-memory`) — la mentira del sobre NO era parte de los fixes (causa raíz sin cambios: `PLATFORM_PRODUCER` en `packages/shared/src/constants.ts:87` usada por `nats.provider.ts:213`).

### 2.3 `GATEWAY_AUDIT` (2 eventos: seq41771, seq41969)

| Etiqueta | Regla | EVIDENCIA | CONFIANZA |
|---|---|---|---|
| gateway-audit / audit | 14 | `subject="audit.gateway.request"`; ambos son probes de Kubernetes (`path="/readyz"`, `userAgent="kube-probe//"`) — infraestructura, sin relación con las historias | ALTA |

---

## 3. Reglas de TAXONOMY.md §4 sin tráfico en esta muestra

Las mismas **9 de 18** que en la muestra anterior:

| Regla | Nombre / patrón |
|---|---|
| 1 | DLQ |
| 5 | catch-all de kinds de channel-service (no vimos `delivered`/`read`/`failed`) |
| 7 | agent-admin |
| 8 | agent-scheduling |
| 10 | registry-sync |
| 11 | connector-invocation |
| 12 | runtime-streaming |
| 13 | tenant-provisioning |
| 15 | legacy (`events.>` / `results.>`) |

Con tráfico: 2, 3, 4, 6, 9 (ahora con las tres variantes proposed/published/rejected), 14, 16, 17.

---

## 4. Dudas, MEDIA/BAJA, unknowns e historias que no cierran

### 4.1 MEDIA/BAJA

**No hay ningún evento MEDIA ni BAJA en esta muestra.** En la pasada anterior los 10 BAJA eran los vínculos narrativos por cercanía temporal de los eventos de workflow-service; con el fix 2 esos eventos ahora traen `correlation_id` y `causation_id` verificables, así que el vínculo dejó de ser hipótesis. Las 72 etiquetas son ALTA (la aplicación de las reglas es inequívoca en todos los casos).

### 4.2 Unknowns, con hipótesis

- **`online.v1` (24 eventos) — business_fn unknown por regla 16.** HIPÓTESIS (igual que antes): heartbeat de salud no contemplado al escribir la regla 6. Sigue siendo el candidato obvio a una regla nueva, fuera del alcance de este documento.
- **`workflow-service...execution_completed.v1` (8 eventos) — tech y business_fn unknown por regla 17.** La CLASIFICACIÓN no cambió (el 5° token del subject sigue siendo `internal`, fuera de la lista blanca de canales) — lo que cambió es que ahora se sabe con certeza, por IDs, a qué historia pertenece cada uno. HIPÓTESIS de significado: notificación de fin de ejecución de workflow; si se quisiera clasificarla habría que agregar una regla, cosa que TAXONOMY.md hoy no permite hacer desde acá.

### 4.3 Historias que no cierran y residuales conocidos

- **Residual esperado (fix 3 diferido, NO es hallazgo nuevo):** en las 4 cadenas de conversación, la causación de los `send` (seq1244, 1252, 1264, 1280, 1285) y de los `execution_completed` de workflow apunta al evento `received`, salteando la ejecución del agente que en realidad generó el texto de la respuesta (ej.: seq1252 tiene `causation_id="208e49bf..."` = el received, no `"f4dee42f..."` = el `execution_completed` del bot). Con la correlación unificada esto ya no impide armar la traza completa; solo pierde precisión el árbol causal en ese salto.
- **`memory_proposed` orgánicos siguen sin causación hacia su ejecución (por diseño):** los 4 eventos de §2.2 se vinculan a su conversación solo por `metadata.agentId`/`sessionId`. El fix 4 ancló deliberadamente published/rejected → proposed; anclar proposed → ejecución sería un cambio adicional no aprobado. Se deja constancia como límite conocido, no como falla.
- **Los 2 ciclos de memoria que sí cierran son fixtures de prueba:** las memorias `bb0135b3` (published) y `da052291` (rejected) fueron creadas a propósito para validar el anclaje (contenido literal: "Temporary test memory to validate causation anchoring. Safe to delete."). El cierre está verificado con datos reales del bus, pero todavía no hay una muestra de un approve/reject **orgánico** post-fix — queda como pendiente de observación.
- **Nada más queda abierto:** no hay respuestas sin pedido, ni causaciones apuntando fuera de la muestra, ni cambios de esquema de `correlation_id` dentro de una misma cadena. El único cruce de frontera restante es el ya documentado cambio de canal/cuenta en el escalamiento HTTP→Telegram (entra por la cuenta HTTP `953c1f5d...`, sale por la cuenta Telegram `0805f09d...`, seq1258 vs seq1264) — unido correctamente por correlación y causación, es un patrón de negocio, no un error.
