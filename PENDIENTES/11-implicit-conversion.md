# 11 · ValidationPipe: opciones copiadas + trampa `enableImplicitConversion`

Class: register
Summary: La opción `enableImplicitConversion` del ValidationPipe de producción convive con DTOs de arrays de objetos sin tipar en potencialmente 17 servicios; las opciones del pipe están copiadas en 4 lugares (1 de ellos producción). Origen: hallazgo de plataforma de `09-hallazgos-group-c.spec.md` T01d.

## El bug ya probado (agent-admin, cerrado)

`09-hallazgos-group-c.spec.md` T01d: `enableImplicitConversion: true` +
campo array-de-objetos sin `@Type`/`@ValidateNested` ⇒ el pipe mangla el
payload en silencio. Se arregló en agent-admin (patrón `tools`), con un test
genérico que auto-descubre campos vulnerables
(`test/unit/agents.dto.transform.spec.ts`).

## Lo que queda abierto

1. **Opciones copiadas** (paridad-por-copia, se desincronizan solas):
   - ~~Producción canónica: `bootstrap-fastify.ts:47-53`~~ **RESUELTO por T01**:
     constante `PRODUCTION_VALIDATION_PIPE_OPTIONS` en
     `packages/observability/src/validation-pipe-options.ts`, pinneada por test
     de paridad. (`bootstrap-split-service.ts` nunca tuvo copia inline — solo
     reenvía `withValidationPipe`; error del registro original.)
   - ~~api-gateway `src/main.ts:58` pipe propio~~ **RESUELTO por T01**: era
     byte-idéntico, ahora importa la constante.
   - ~~Los 3 tests de agent-admin que copiaban para paridad~~ **RESUELTO por
     T01**: importan la constante.
   - ~~Copias que T01 NO tocó (fuera de su alcance; las levanta el barrido
     T02): `services/api-gateway/test/unit/gateway-validation-pipe.http.spec.ts:54`,
     `services/api-gateway/test/unit/runtime-execution-metadata.spec.ts:44` y
     `services/ai-agent-gateway/test/unit/executions-metadata-dto.spec.ts:43`~~
     **RESUELTO por T02**: los tres importan
     `PRODUCTION_VALIDATION_PIPE_OPTIONS` de `@yoizen/observability`, con sus
     aserciones intactas. No queda ninguna copia inline de las opciones en el
     repo.
2. **La misma trampa puede existir en cualquiera de los ~17 servicios** que
   pasan `withValidationPipe: true` al bootstrap compartido (lista por
   `rg -l withValidationPipe services`). Nadie la barrió.

## Plan (spec `11-implicit-conversion.spec.md`)

T01 extrae las opciones a una constante exportada de `packages/observability`
(los 4 copiones la importan, test de paridad la pinnea). T02 corre el barrido
de auto-descubrimiento en los 17 servicios: los limpios quedan pinneados con
el test permanente; los sucios se registran ACÁ como hallazgos y el loop se
DETIENE para ruling de Christian antes de tocar producto.

## Hallazgos del barrido T02

Barrido corrido el 2026-08-08 sobre la población viva
(`rg -l "withValidationPipe: true" services` + api-gateway, que arma su propio
pipe). Regla de detección: propiedad cuyo `design:type` reflejado es `Array`,
sin `@Type(...)` y sin validación elemento-a-elemento escalar (`{ each: true }`).
Los campos `Object` sin tipar (`metadata`, `configuration`, `authConfig`,
`payload`, `envVars`, …) se probaron también y **sobreviven intactos** — la
conversión implícita sólo destruye elementos-objeto dentro de arrays.

Cada hallazgo está reproducido con el pipe real
(`PRODUCTION_VALIDATION_PIPE_OPTIONS`) y **excluido** del test de barrido del
servicio vía la constante `KNOWN_MANGLED_FIELDS` de
`test/unit/dto.transform.spec.ts`, para no commitear un test rojo. Ningún
código de producto fue tocado: esperan ruling de Christian.

### H1 · api-gateway — `CreateAgentDto` / `UpdateAgentDto` (ALTO)

- Archivo: `services/api-gateway/src/modules/admin/admin.dto.ts`
- Campos: `CreateAgentDto.channels`, `CreateAgentDto.input_variables`,
  `CreateAgentDto.output_variables`, `UpdateAgentDto.channels`
  (todos `@IsArray() @IsOptional()` sobre `unknown[]`, sin `@Type`).
- Reproducción:
  - IN `{"name":"support-bot","system_prompt":"…","tools":[{"type":"search","name":"search_tickets"}],"channels":[{"type":"webchat","config":{"widget_id":"w-1"}}],"input_variables":[{"name":"customer_name","type":"string","required":true}],"output_variables":[{"name":"resolution","type":"string","required":false}]}`
  - OUT `{"name":"support-bot","system_prompt":"…","tools":[{"type":"search","name":"search_tickets"}],"channels":[[]],"input_variables":[[]],"output_variables":[[]]}`
- Impacto estimado: **es exactamente el bug T01d, todavía abierto en la puerta
  de entrada**. agent-admin fue parchado (`@Type(() => Object)` en los cuatro
  campos), api-gateway sólo recibió el parche en `tools`. Todo alta/edición de
  agente que pase por `POST/PATCH /api/admin/agents` pierde canales y variables
  de entrada/salida antes de llegar a agent-admin — silenciosamente, con 2xx.
- Fix candidato (no aplicado): `@Type(() => Object)` en los cuatro campos.

### H2 · api-gateway — `SendChannelMessageBodyDto.templateComponents` (ALTO)

- Archivo: `services/api-gateway/src/modules/channels/channels-gateway.dto.ts:137`
- Campo: `templateComponents?: Record<string, unknown>[]` con `@IsArray()` solo.
- Reproducción:
  - IN `{"to":"5491100000000","type":"template","templateName":"order_update","templateLanguage":"es","templateComponents":[{"type":"body","parameters":[{"type":"text","text":"1234"}]}]}`
  - OUT `…,"templateComponents":[[]]}`
- Impacto estimado: envío de plantillas WhatsApp por
  `POST /api/channels/:accountId/messages`: los `components` (parámetros del
  template) llegan vacíos a channel-service → Meta rechaza el envío o manda la
  plantilla sin variables. Ruta usada por el producto.

### H3 · channel-service — `SendMessageDto.templateComponents` (ALTO)

- Archivo: `services/channel-service/src/modules/egress/egress.dto.ts:24`
- Mismo campo, mismo defecto, un salto más abajo
  (`EgressController` `@Body() dto: SendMessageDto`).
- Reproducción:
  - IN `{"to":"5491100000000","type":"template","templateName":"order_update","templateLanguage":"es","templateComponents":[{"type":"body","parameters":[{"type":"text","text":"1234"}]}]}`
  - OUT `…,"templateComponents":[[]]}`
- Impacto estimado: aunque se arregle H2, el egress directo a channel-service
  sigue perdiendo los componentes. Los dos DTOs necesitan el mismo fix.

### H4 · api-gateway — `WebhookInboundBodyDto.entry` (LATENTE, no vivo)

- Archivo: `services/api-gateway/src/modules/channels/webhooks-gateway.dto.ts`
- Campo: `entry?: unknown[]` con `@IsArray()` solo.
- Reproducción:
  - IN `{"object":"whatsapp_business_account","entry":[{"id":"waba-1","changes":[{"field":"messages","value":{"messages":[{"id":"wamid.1"}]}}]}]}`
  - OUT `{"object":"whatsapp_business_account","entry":[[]]}`
- Impacto estimado: **hoy ninguno** — la clase NO se usa como `@Body()`:
  `WebhooksController.receive/receiveInstance` leen `request.rawBody` crudo
  (ver H7). Está declarada sólo para documentación OpenAPI
  (`api-gateway/OPENAPI-TODO.md`). Pero si alguien "mejora" el controller
  atándole el DTO, **todo webhook entrante de Meta/WhatsApp perdería `entry`**.
  Trampa cargada.

### H5 · api-gateway — `QueryStructuredKbDto.categories` (BAJO)

- Archivo: `services/api-gateway/src/modules/admin/admin.dto.ts:572`
- Campo declarado `categories?: string[]` con `@IsArray()` solo.
- Reproducción: con el payload real (`["tarifas"]`) **sobrevive**; sólo se
  destruye si el cliente manda objetos (`[{"name":"tarifas"}]` → `[[]]`).
- Impacto estimado: bajo. El DTO acepta cualquier array (no valida elementos),
  así que la corrupción es alcanzable por un cliente mal implementado y llega
  como `[[]]` en vez de un 400. Fix barato: `@IsString({ each: true })`.

### H6 · agent-admin-service — `UploadSKBFileDto.categories` (BAJO)

- Archivo: `services/agent-admin-service/src/modules/structured-kb/dto/upload-skb-file.dto.ts`
- Mismo caso que H5 (`categories?: string[]`, `@IsArray()` solo), usado por
  `ContainersController` `@Body() dto: UploadSKBFileDto`.
- Reproducción: `["tarifas"]` sobrevive; `[{"name":"tarifas"}]` → `[[]]`.
- Impacto estimado: bajo, mismo razonamiento y mismo fix que H5.

### H7 · Workarounds vivos que existen POR esta trampa (ALTO como deuda)

No son bugs: son código de producto que ya evita el pipe porque la conversión
implícita corrompe. Se registran porque son la evidencia de que la opción está
costando caro, y porque desaparecerían si se resuelve la causa raíz.

- `services/api-gateway/src/modules/workflows/workflows.controller.ts:44-47`
  (comentario) → `createWorkflow` (`:51`) y `updateWorkflow` (`:62`):
  NO declaran DTO, leen `req.body` crudo,
  con el comentario *"actions/trigger contain opaque nested objects that
  class-transformer's enableImplicitConversion corrupts"*. Verificado: real.
- `services/api-gateway/src/modules/channels/webhooks.controller.ts`:
  `receive` (`:54`) y `receiveInstance` (`:73`) usan `request.rawBody` (Buffer,
  `:88`) en lugar del `WebhookInboundBodyDto` de H4.
- Consecuencia: esas rutas quedan **sin validación de entrada** en el gateway.

### Recomendación para el ruling (no ejecutada)

Dos caminos, excluyentes:

1. **Puntual**: `@Type(() => Object)` en H1/H2/H3 y `@IsString({ each: true })`
   en H5/H6. Barato, pero la trampa sigue armada para el próximo DTO.
2. **Estructural**: apagar `enableImplicitConversion` en
   `PRODUCTION_VALIDATION_PIPE_OPTIONS` y declarar `@Type(() => Number/Boolean)`
   explícito en los query DTOs que hoy dependen de la coerción implícita.
   Elimina la clase de bug y desbloquea los workarounds de H7, pero es un
   cambio wire-adjacent que toca los ~15 servicios a la vez y necesita su
   propio barrido de query DTOs.

Los tests de barrido (`services/*/test/unit/dto.transform.spec.ts`) quedan como
pin permanente: cualquiera de los dos caminos se valida sacando el campo de
`KNOWN_MANGLED_FIELDS` y viendo el test pasar.
