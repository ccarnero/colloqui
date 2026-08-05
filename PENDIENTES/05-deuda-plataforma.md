# 5 · Deuda de plataforma

Class: register
Summary: Huecos estructurales que aparecieron al construir, más dos TODOs de arquitectura que el usuario pidió registrar; ninguno bloquea nada hoy.

---

## Sin teardown declarativo

`provisioning-service` expone `validate`, `PUT :name`, `GET :name`, `plan` y
`apply` — **ninguna ruta de delete**, ni concepto de teardown. No existe
"borrá este manifiesto y sus recursos".

Consecuencia: todo script e2e borra recurso por recurso de forma imperativa.
No es desprolijidad de los scripts — es que no hay alternativa. El "teardown
sweep" de `manifest-apply.sh` tiene el mismo problema; su propio comentario dice
que va *"straight to connector-admin"*.

**Verificado**, no supuesto: se listaron las rutas de los controllers.

## El publish de un agente no se puede expresar en un manifiesto

`POST /api/admin/agents/:id/publish` es imperativo y no tiene equivalente
declarativo: `manifest.schema.ts` **no tiene el concepto** de publish. Por eso
el e2e lo hace a mano.

## El manifiesto no puede fijar el `provider` de un canal

`channelSchema` tiene `type` pero no `provider`, así que la cuenta toma el
default de la base (`DEFAULT 'meta'`). Se ve en los envelopes del canal nuevo:
salen con `provider: "meta"` y `type: io.yoizen.messaging.e2e-tests.meta.sent.v1`.

Cosmético, no rompe nada. Preexistente.

---

## TODOs de arquitectura (pedidos por Christian)

### Dar de baja el canal Instagram/Meta

Marcado como "viejo" y a borrar en un esfuerzo aparte. **Verificado antes de
registrarlo:** no es código prematuro — `InstagramProvider` está registrado en
`webhooks.module.ts`, en `provider-registry.ts`, en el union `Channel`, y se usa
en la resolución de cuenta del webhook ingress y en la validación de auto-reply.
Es código productivo integrado, solo que ya no se lo quiere.

Alcance: `services/channel-service/src/providers/meta/**`, el token en el union,
`DOCS/channels/instagram.md`. Memoria Engram #1239.

### Schema de manifiestos con fuente `file`

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

## Rule-5: un README todavía en español

`demos/crm-support-telegram/README.md` sigue completamente en español. Viola la
regla 5 de AGENTS.md y **ningún ítem D/O de la ronda T09 lo cubrió** — se marcó
durante T10 sin reescribirlo, para no exceder el alcance aprobado.
