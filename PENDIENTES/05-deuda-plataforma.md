# 5 · Deuda de plataforma

Class: register
Summary: Huecos estructurales que aparecieron al construir, más dos TODOs de arquitectura que el usuario pidió registrar; ninguno bloquea nada hoy.

---

## Sin teardown declarativo — **PARKEADO a Fase 4**

`provisioning-service` expone `validate`, `PUT :name`, `GET :name`, `plan` y
`apply` — **ninguna ruta de delete**, ni concepto de teardown. No existe
"borrá este manifiesto y sus recursos".

Consecuencia: todo script e2e borra recurso por recurso de forma imperativa.
No es desprolijidad de los scripts — es que no hay alternativa. El "teardown
sweep" de `manifest-apply.sh` tiene el mismo problema; su propio comentario dice
que va *"straight to connector-admin"*.

**Verificado**, no supuesto: se listaron las rutas de los controllers.

Fase 4 lo toma en el orden `defaultCache` → `provider` → publish → teardown →
file-source, así que este ítem entra anteúltimo.

## El publish de un agente no se puede expresar en un manifiesto — **PARKEADO a Fase 4**

`POST /api/admin/agents/:id/publish` es imperativo y no tiene equivalente
declarativo: `manifest.schema.ts` **no tiene el concepto** de publish. Por eso
el e2e lo hace a mano.

## El manifiesto no puede fijar el `provider` de un canal — **PARCIAL, resto parkeado a Fase 4**

`channelSchema` tiene `type` pero no `provider`: el manifiesto sigue sin poder
fijarlo. Eso es lo que queda abierto y se trata en Fase 4 (orden:
`defaultCache` → `provider` → publish → teardown → file-source).

Lo cosmético ya murió en T02 (`260d8bd4`): la columna `provider` perdió su
`DEFAULT 'meta'` (más un `ALTER COLUMN ... DROP DEFAULT` idempotente para los
tenants existentes) y `providerFor` dejó de tener fallback, así que los
envelopes del canal de e2e salen con `provider: "e2e-tests"` y
`type: io.yoizen.messaging.e2e-tests.e2e-tests.sent.v1`, pinneado en tests.

---

## TODOs de arquitectura (pedidos por Christian)

### Dar de baja el canal Instagram/Meta — **EJECUTADO 2026-08-11**

> Aprobado por ruling D3 (2026-08-07). Ejecutado con la spec estilo E11
> `PENDIENTES/05-deuda-plataforma.spec.md` (Fase 3), en tres tareas:
>
> - **T01** — `3250c835`: se borró la familia de providers Meta
>   (`services/channel-service/src/providers/meta/**`, WhatsApp incluido por
>   ruling de alcance), murió `ProviderRegistry` (el `ChannelRouter` registra
>   telegram/http/e2e-tests directo) y se removió el camino de verificación
>   `hub.challenge` de punta a punta, incluida la ruta `GET` del api-gateway.
>   Pin de comportamiento: un webhook sin firma es `signature_mismatch` en todo
>   canal — el fallback legacy "primera cuenta activa" ya no existe.
> - **T02** — `260d8bd4`: se achicó el contrato. Los unions quedaron
>   `telegram | http | e2e-tests` (canal y provider), el DDL perdió las columnas
>   Meta (`phone_number_id`, `waba_id`, `ig_user_id`, `app_id`, `verify_token`)
>   y el `DEFAULT 'meta'`, `providerFor` quedó exhaustivo y el SDK/gateway
>   perdieron el refresh-token y los campos Meta de la cuenta.
> - **T03** — esta tarea (commit pendiente, lo pone el orquestador): barrido de
>   documentación. Se borró `DOCS/channels/instagram.md` y se reescribieron
>   alrededor de Telegram las secciones Meta de `ingress.md`, `channel-service.md`,
>   `security.md`, `multi-tenancy.md`, `envelope.md`, `overview.md`, `service-bus.md`
>   y los READMEs de servicio; se sacaron `x-hub-signature-256`/`x-hub-signature`
>   de `WEBHOOK_FORWARDED_HEADERS` (con su doc-lock y el §4.1 de `envelope.md`
>   en el mismo cambio) y se actualizaron los assets de
>   `skills/envelope-messages` junto con su pin en
>   `packages/shared/test/unit/envelope-schema.spec.ts`, que pasó de "KNOWN
>   DRIFT" a espejo completo de los unions vivos.

Verificación previa al registro (se mantiene como evidencia de que no era
código prematuro): `InstagramProvider` estaba registrado en `webhooks.module.ts`
y en `provider-registry.ts`, vivía en el union `Channel`, y se usaba en la
resolución de cuenta del webhook ingress y en la validación de auto-reply. Era
código productivo integrado; simplemente ya no se lo quería. Memoria Engram #1239.

### Schema de manifiestos con fuente `file` — **PARKEADO a Fase 4**

Para que `acme-telco-policy.md` y `support-faq.md` tengan una sola fuente real.
Hoy el schema solo acepta `type: "inline"` para documentos de KB, así que el
`.md` y la copia inline del manifiesto conviven.

Paliativo ya aplicado en T10: un script de sync regenera el bloque inline desde
el `.md`, que pasa a ser la única fuente editada a mano.

El fix de fondo cambia la propiedad de "manifiesto autocontenido y portable"
que hoy tienen los samples, así que necesita su propia ronda de diseño.
Afecta `ai-skill-support-agent`, `ai-knowledge-base-agent` y
`demos/crm-support-telegram`. Memoria Engram #1249.

---

## Rule-5: un README todavía en español — **CERRADO por Fase 1**

`demos/crm-support-telegram/README.md` estaba completamente en español y ningún
ítem D/O de la ronda T09 lo cubrió. Lo cerró la Fase 1 (registro 03, cerrado
08-07): **verificado 2026-08-11 — el README está en inglés**. No queda trabajo
de traducción; el ítem se deja acá solo como rastro.
