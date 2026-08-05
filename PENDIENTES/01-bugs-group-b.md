# 1 · Group B — 13 bugs reales

Class: register
Summary: Los trece bugs de código que la auditoría docs-vs-código encontró de refilón; cada uno necesita su propio ticket y ninguno se tocó.

Salieron de auditar documentación contra código: al verificar si un doc decía
la verdad, apareció que **el código estaba mal**. Ruling de T09: cada uno es un
ticket independiente, fuera del alcance de la auditoría (que era docs-only).

Los cinco primeros son los que tienen impacto hoy.

---

## Rotos ahora mismo

### E36 · `cache-service` corre 24/7 sin que nadie lo llame

Desplegado con `min-scale: "1"` — o sea, un pod permanente — pero **no tiene
ruta en el api-gateway ni un solo llamador**. `rg "CACHE_SERVICE_URL"` da
exactamente 4 hits: uno en `gateway.config.ts`, uno en un README y dos en
overlays. Ninguno es una llamada. Su propio README admite que no llama a nadie
y nadie lo llama.

**Decisión requerida:** borrar el servicio, o cablear la ruta del gateway.
Dejarlo como está es la única opción que cuesta recursos sin dar nada.

### E11 · Los conectores OAuth2 salen sin `Authorization`

`connector-admin` acepta `authType: "oauth2-client"`, pero **los dos**
inyectores de header hacen `switch` sobre `"oauth2"`. Un conector configurado
como `oauth2-client` sale **sin header de autenticación**, en silencio.

### E13 · `agent-scheduler-service` no puede agendar nada

Tal como está desplegado: sin descubrimiento ni seeding de tenants, sin
`LEADER_ELECTION_POSTGRES_URL` ni `REDIS_URL` en el manifiesto. Y el health
reporta `ok` igual, así que nada alerta.

**Decisión requerida:** arreglarlo, o admitirlo como no-desplegado.

### E10 · Dos suites de tests que nunca corren un test

`proxy-service` y `tenant-service` definen su script `test` en términos de
`pnpm test` — **recursión infinita**. Ningún test de esos dos servicios se
ejecutó nunca.

### E27 · El smoke-test aprueba con workers caídos

`scripts/smoke-test.sh` verifica **8 de 11** Deployments de workers: omite
`connector-runtime-http`, `connector-runtime-invoke` y
`tracking-ingester-worker`. Los **dos** orquestadores de arranque lo usan como
gate de readiness, así que el bring-up puede declararse "listo" con tres
workloads en crash-loop.

---

## El resto

### E15 · El CLI del SDK está sin testear por su comando documentado

`"test": "tsx --test 'test/**/*.test.ts'"` nunca alcanza los **14 specs
co-ubicados** en `src/cli/**/*.test.ts` — todo el CLI `yoizen`, incluido
`--secrets-from-env`, queda fuera. Con `bun test` aparecen: 471 vs 343.
**Fix:** ampliar el glob y rebaselinar el conteo.

### E18 · El paso principal de un sample siempre imprime `(missing!)`

`ai-system-variables` busca nombres en camelCase mientras el manifiesto declara
slugs. El paso más visible del sample falla siempre.

### E29 · `dev-mode.sh` mapea mal `connector-runtime`

Lo trata como 1 Deployment; los manifiestos declaran **3**, y
`rebuild-redeploy.sh` rolea los 3. Arreglar junto con la tabla de E34.

### E33 · `rebuild-redeploy.sh` persigue un ksvc fantasma

Busca un `connector-runtime` ksvc que no existe (warning en cada rebuild). Su
`usage()` además subestima la fase de deploy y anuncia overlays
`qa`/`staging`/`production` que no existen.

### E24 · `purge-circuit-breakers.sh` no puede reportar fallas

`any_error` se declara y **nunca se asigna**; encima cada operación corre bajo
`|| true`. El script no puede fallar aunque todo falle.

### E25 · `mapfile` rompe la regla de bash 3.2 del repo

En la rama de Redis-cluster. Latente solo porque el Redis de dev es standalone.

### E28 · El hook PostToolUse corre un runner inexistente

Ejecuta `vitest related`, pero `vitest` existe en **un** manifiesto de todo el
repo (`admin-console`). La mitad de testing del hook es inerte para casi toda
edición. **Fix:** elegir el runner real.

### E12 · `parseFrontmatter` parte YAML con `indexOf(":")`

En `SkillFileService`: `description: >` queda como el literal `">"`.
**Fix:** parsear YAML de verdad, o validar el frontmatter con un guard.

---

## Evidencia

Todos con su cita en `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` y en la sección
(g) de `manual-loops/architecture/docs-truth-audit.md`.
