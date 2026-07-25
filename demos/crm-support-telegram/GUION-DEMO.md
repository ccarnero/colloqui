# Guion de demo — crm-support-telegram

Guion verificado en vivo el 2026-07-25 contra el clúster de dev: cada respuesta "esperada" de
abajo es la respuesta REAL que devolvió el sistema en esa fecha (ejecuciones 15:37 y 15:40 UTC),
no un ejemplo inventado. Duración estimada: ~5 minutos.

## Estado que la demo necesita sembrado

| Qué | Valor de referencia (siembra 2026-07-25) |
| --- | --- |
| Contacto HubSpot con `telegram_user_id` del presentador | `237594495271` ("Christian Demo VIP") |
| Deals abiertos asociados (>= 3 dispara VIP) | `63140996230`, `63142088072`, `63148403872` |
| Bot de Telegram | `@yzndev_bot` |
| Túnel público (webhook) | `https://api.devmachina.net` (cloudflared, origen puerto 80 + Host header del gateway) |

Los ids cambian con cada re-siembra; lo estable es la forma: un contacto cuyo `telegram_user_id`
es el chat id del presentador, con 3+ deals abiertos asociados. Para re-sembrar: crear el contacto
(`POST /crm/v3/objects/contacts` con la propiedad `telegram_user_id`), crear 3 deals
(`POST /crm/v3/objects/deals`, solo `dealname` — el pipeline default los deja abiertos) y
asociarlos (`PUT /crm/v4/objects/deals/{dealId}/associations/default/contacts/{contactId}`).

## Advertencias críticas (aprendidas a golpes)

1. **NO correr `run.sh` antes ni durante la demo.** Su siembra hace "create-or-reuse por
   `telegram_user_id`": reutiliza el contacto sembrado de la demo y su limpieza LO BORRA, deals
   incluidos. Esto pasó en vivo el 2026-07-25 — el presentador quedó `tier=standard` a mitad de
   conversación. Si `run.sh` corrió, re-sembrar antes de entrar a la sala.
2. **Cada turno VIP re-escala.** El `idempotencyKey` del ticket es por ejecución, así que CADA
   mensaje del contacto VIP genera un banner "⚠️ VIP escalation" y un ticket NUEVO en HubSpot.
   No es un loop: es un turno nuevo re-verificando el CRM. Para la sala: o se corta la
   conversación en dos turnos, o se narra como feature ("cada interacción re-verifica la
   prioridad en vivo").
3. **Mensajes autocontenidos.** Cada mensaje de Telegram es una ejecución nueva del workflow; la
   memoria conversacional entre turnos es limitada. Si el cliente da los datos en cuotas
   ("1111"… "las frutillas…"), el agente vuelve a pedir contexto y se siente repetitivo. Los
   mensajes del guion incluyen todo el contexto en un solo turno.
4. El cache de lectura del conector HubSpot (`list-deals-by-contact`) dura 60 s: si se acaban de
   tocar los deals del contacto, esperar un minuto antes del primer mensaje VIP.

## Preparación (antes de la sala)

- cloudflared arriba y `getWebhookInfo` apuntando al túnel, sin `last_error_message`.
- Admin-console abierto en **Processes** (para la run-view) y HubSpot abierto en **Tickets →
  Support Pipeline**.
- `yoizen manifests plan -f manifest.yaml` como sanity check: todo `noop` = clúster convergido.

## Acto 1 — Cliente común (desde OTRA cuenta de Telegram, no la sembrada)

> "Cualquier cliente le escribe al bot. Este usuario no existe en el CRM."

**Enviar:** `Hola, tengo una consulta sobre mi pedido`

**Respuesta esperada del sistema:** respuesta cortés estándar, SIN banner de escalación y SIN
ticket. En la run-view: `searchContact` no encuentra contacto → `scoreContact` →
`tier=standard` → rama default → `replyStandard`.

## Acto 2 — Cliente VIP (la cuenta sembrada; el momento clave)

> "Ahora escribe un cliente con 3 oportunidades abiertas en HubSpot. El agente no lo sabe de
> antemano: lo averigua en vivo consultando el CRM."

**Enviar (un solo mensaje, no partirlo):**

`Hola, tengo un problema con mi ultimo pedido, el 1122: las frutillas llegaron en mal estado.`

**Respuesta real verificada (2026-07-25 15:37 UTC):**

- Banner: **"⚠️ VIP escalation — a specialist will follow up shortly."**
- Reply del agente (textual): *"Hola, Christian. Lamento mucho saber que las frutillas llegaron
  en mal estado. Entiendo la importancia de este asunto, especialmente como cliente VIP.
  Permíteme ayudarte a resolverlo lo más rápido posible. Para comenzar, necesito un poco más de
  información: ¿te gustaría que gestionáramos un reembolso o un reemplazo de las frutillas?…"*
- Backstage (mostrar en la run-view): `tier=vip`, `score=85`,
  `reasons=["open-deals-vip-threshold-met:3","open-deals:3","unresolved-tickets:0"]`, nodo
  `createTicket` disparado en modo async.
- En HubSpot: ticket nuevo en Support Pipeline → New, subject
  "VIP escalation via Telegram support bot", prioridad HIGH.

## Acto 3 — System variables en vivo (opcional pero efectivo)

**Enviar:** `Y cuanto tardan en darme una respuesta?`

**Respuesta real verificada (2026-07-25 15:40 UTC):** *"…nuestro SLA es de 24 horas para las
respuestas. Sin embargo, dada la naturaleza urgente de su caso…"*

El **24** sale de la system variable `crm-support-sla-hours` resuelta en runtime — se puede
cambiar en el admin-console y el bot cita el valor nuevo sin tocar código ni re-desplegar.
Advertencia 2 aplica: este turno también genera banner + segundo ticket.

## Cierre — la toma final

Dos pantallas, lado a lado:

1. La run-view del admin-console de la ejecución VIP: trigger Telegram → `searchContact`
   (HubSpot) → `scoreContact` (servicio hosteado propio) → gate condicional → agente +
   escalación + `createTicket`.
2. HubSpot con el ticket recién creado.

Remate opcional para sala técnica: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
en vivo — todo `noop`: la demo completa es UN archivo declarativo e idempotente.

## Housekeeping post-demo

- Borrar el contacto sembrado y sus 3 deals (`DELETE /crm/v3/objects/contacts/{id}` y
  `/crm/v3/objects/deals/{id}`).
- Borrar los tickets "VIP escalation via Telegram support bot" acumulados durante la demo y los
  ensayos (uno por turno VIP).
