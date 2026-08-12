# 5 · Deuda de plataforma

Class: register
Summary: Huecos estructurales que aparecieron al construir, más dos TODOs de arquitectura que el usuario pidió registrar; ninguno bloquea nada hoy.

---

## Sin teardown declarativo — **EJECUTADO 2026-08-12**

> El diagnóstico original (que se deja tal cual, porque es lo que motivó la
> spec): `provisioning-service` exponía `validate`, `PUT :name`, `GET :name`,
> `plan` y `apply` — **ninguna ruta de delete**, ni concepto de teardown. No
> existía "borrá este manifiesto y sus recursos". Consecuencia: todo script e2e
> borraba recurso por recurso de forma imperativa. No era desprolijidad de los
> scripts — es que no había alternativa. El "teardown sweep" de
> `manifest-apply.sh` tenía el mismo problema; su propio comentario decía que
> iba *"straight to connector-admin"*. **Verificado**, no supuesto: se listaron
> las rutas de los controllers.

Adelantado fuera de la tanda de Fase 4 por ruling del usuario (2026-08-12) y
ejecutado con la spec `PENDIENTES/12-undeploy.spec.md`, en tres tareas:

- **T01** — `b4ac9894`: nuevo verbo `POST /manifests/:name/undeploy` en
  `provisioning-service`. Borra, en el **orden inverso** al de `apply`,
  exactamente los recursos que el manifiesto **guardado** posee; los `external:
  true` nunca se tocan (`skipped_external`). Outcomes por recurso
  (`deleted | not_found | skipped_external | skipped_no_delete_api`),
  stop-at-first-error con reporte parcial, guard 409 `undeploy_blocked` cuando
  otro manifiesto guardado consume un recurso de éste (decisión 4, sin
  `--force` en v1), 404 idempotente, y `DELETE /secrets/:name` (que faltaba)
  para que los secretos mueran con su dueño (decisión 2). El registro guardado
  se borra **último**, y sólo si nada falló: un undeploy parcial lo conserva
  para que re-correrlo resuma. Inventario: **los 9 admin APIs downstream tienen
  ruta de delete** — cero `skipped_no_delete_api`.
- **T02** — `953251b9`: proxy del api-gateway (`POST
  /api/provisioning/manifests/:name/undeploy`), `client.manifests.undeploy()`
  en el SDK con tipos espejo de `undeploy.interfaces.ts`, y el verbo de CLI
  `yoizen manifests undeploy -f <file> [--yes]` (sin `--yes` sólo muestra lo
  que borraría y sale 1; el 404 se renderiza "already undeployed" y sale 0; el
  409 lista los dependientes) más los dos niveles de `--help`.
- **T03** — esta tarea (commit pendiente, lo pone el orquestador): los dos
  scripts e2e pasaron a teardown declarativo. En `scripts/e2e/http-workflow.sh`
  el borrado deja de ser las cuatro pasadas imperativas y pasa a ser un
  `undeploy` del manifiesto de la corrida vía gateway, seguido de una
  verificación explícita, recurso por recurso, de que **cada** recurso del
  manifiesto quedó borrado (assertion que antes no existía: sólo se miraba el
  status del DELETE); las cuatro pasadas quedan degradadas a barrido de residuo
  no-propiedad-del-manifiesto. `scripts/e2e/manifest-apply.sh` undeploya sus
  cinco manifiestos (base, showcase, LibraryManifest, negativo y T05) contra el
  ingress de `provisioning-service`, con su teardown imperativo y su barrido
  intactos abajo como red de seguridad.

**Qué sigue siendo imperativo, a propósito:**

- Los **efectos externos** (decisión 3 de la spec): quitar el `setWebhook` de
  Telegram, las propiedades de HubSpot, las imágenes Docker. Espejo del
  bootstrap — nunca entraron por manifiesto, no salen por undeploy.
- Los barridos por prefijo de nombre de los dos scripts, que quedan como red de
  seguridad para lo que undeploy **no puede** alcanzar: residuo de corridas
  anteriores (cada corrida pisa el manifiesto con nombres nuevos, así que los
  viejos ya no están declarados en ningún lado) y la muerte de
  `manifest-showcase-driver.ts` antes de imprimir su JSON, que deja los nombres
  de tres manifiestos fuera del alcance del script. Ese camino está pinneado por
  `scripts/e2e/teardown-regression.sh`.

**Hallazgos que sobreviven** (cada uno es su propia ronda, ninguno bloquea):

- **Undeploy no emite eventos de auditoría.** `apply` emite `apply_started` /
  `resource_applied` / `apply_completed`; el verbo nuevo no emite nada — hacen
  falta clases de evento nuevas registradas en la taxonomía.
- **Falta un marcador de propiedad por manifiesto.** Ningún kind guarda "me
  creó el manifiesto X": `channels-writer.ts` estampa
  `externalId: "manifest:<nombre del CANAL>"`, que prueba procedencia de apply
  pero no de QUÉ manifiesto; el resto se borra buscando por nombre. Dos
  manifiestos con un recurso del mismo nombre son indistinguibles al
  desmontar. Ronda de writers: estampar `manifest:<manifiesto>/<recurso>`.
- **El 404 del segundo undeploy no tiene cuerpo tipado.** Llega como texto, y
  el SDK/CLI lo interpretan por status; una ronda de provisioning debería
  devolver `kind: "manifest_not_found"`.
- **Las convenciones de not-found downstream están partidas** entre 404 y
  200-con-`false` (borrados lógicos), y el deleter tiene que tolerar ambas.
- ~~**El ClusterRole de secrets no tiene el verbo `delete`**~~ — **CERRADO en la
  misma T03**. Hallazgo real (`knative/services/rbac/cluster-role.yaml` tenía
  `create`/`get`/`list`/`update`/`patch`): `deleteKey` (`k8s-secrets-store.ts`)
  reescribe el Secret cuando quedan otras claves —eso entra por `update`—, pero
  cuando borra la **última** llama a `deleteNamespacedSecret`, que RBAC
  rechazaba; undeployar un manifiesto cuyo binding es la única clave de su
  Secret terminaba en `downstream_error` (409 parcial). El orquestador lo
  declaró en alcance (la decisión 2 de la spec — "los secretos mueren con el
  manifiesto" — exige el grant) y se agregó `delete` a la regla de `secrets`
  del ClusterRole `provisioning-service-secrets-manager`, con el comentario del
  yaml reescrito: la razón vieja ("no `delete`, T05 es create-or-update") queda
  superada, y la decisión 8 sigue siendo cierta para `apply`, que nunca borra.
  Aplicado al cluster el 2026-08-12 y verificado en vivo: undeploy de un
  manifiesto de prueba con secret binding borró físicamente el Secret k8s
  (`psec-channel-...`) al remover su última key.

## El publish de un agente no se puede expresar en un manifiesto — **PARKEADO a Fase 4**

`POST /api/admin/agents/:id/publish` es imperativo y no tiene equivalente
declarativo: `manifest.schema.ts` **no tiene el concepto** de publish. Por eso
el e2e lo hace a mano.

## El manifiesto no puede fijar el `provider` de un canal — **PARCIAL, resto parkeado a Fase 4**

`channelSchema` tiene `type` pero no `provider`: el manifiesto sigue sin poder
fijarlo. Eso es lo que queda abierto y se trata en Fase 4 (orden:
`defaultCache` → `provider` → publish → file-source; el `teardown` salió de esa
tanda y ya está ejecutado — ver el primer ítem de este archivo).

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
