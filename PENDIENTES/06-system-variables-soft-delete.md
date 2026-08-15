# 6 · System variables soft-deleteadas rompen el manifest apply

Class: register
Summary: El create de `agent-admin-service` no reactiva variables soft-deleted; cualquier `systemVariable` con `is_active=false` deja al manifest engine en un 500 irrecuperable. Corregir INMEDIATAMENTE después de correr T05 del POC Siri (ruling del usuario, 2026-08-15).

---

## El bug (verificado en vivo, 2026-08-15)

`yoizen manifests apply -f manifest.yaml --secrets-from-env` en
`demos/crm-support-telegram` falló así:

```
failure: downstream_error on systemVariable/crm-support-company-name:
HTTP 500 from http://agent-admin-service.platform-services-dev.svc.cluster.local/admin/system-variables
applied=6 pending=2
```

Cadena causal, cada eslabón verificado:

1. Las filas **existen** en `tenant_acme.public.system_variables` con los
   valores exactos del manifiesto (`crm-support-company-name` = "Acme Support
   Co", `crm-support-sla-hours` = "24"), pero con **`is_active = false`**
   (updated_at 2026-08-13 18:46 — algo las desactivó ese día).
2. `GET /admin/system-variables` (header `x-yoizen-tenant: acme`) filtra por
   activas → devuelve `{"variables":[],"total":0}`.
3. El manifest engine, al no verlas en el listado, decide **crear** en vez de
   converger.
4. El `POST` inserta una fila nueva → choca la unique
   `idx_system_vars_tenant_name (tenant_id, name)` — la constraint no
   distingue `is_active` → `PostgresError: duplicate key value violates
   unique constraint` → 500 sin mensaje útil hacia el engine.

Resultado: **loop irrecuperable** — ningún re-apply puede salir de ahí porque
leer y escribir ven mundos distintos.

## El fix requerido (elegir uno, en `agent-admin-service`)

- **Opción A (preferida):** el create detecta la fila soft-deleted con mismo
  `(tenant_id, name)` y la **reactiva + actualiza** (upsert semántico). El
  soft-delete conserva su gracia (historial/undo) y el apply converge.
- **Opción B:** índice único **parcial** `WHERE is_active` + create siempre
  inserta. Más simple, pero acumula filas muertas homónimas y el "undo" del
  soft-delete pierde sentido.
- En cualquier caso: el 500 de Postgres no debe llegar crudo al manifest
  engine — mapear a 409 con cuerpo que nombre el conflicto.

Bonus del mismo rastreo: falta test que cubra "apply sobre variable
soft-deleted" — es exactamente el caso que ningún e2e ejercita hoy.

## Workaround aplicado mientras tanto (data fix, no code fix)

```
kubectl exec -n support-services-dev postgres-shared-1 -c postgres -- \
  psql -U postgres -d tenant_acme -c \
  "UPDATE system_variables SET is_active = true, updated_at = now()
   WHERE tenant_id='acme' AND name IN ('crm-support-company-name','crm-support-sla-hours');"
```

y re-correr el apply. Esto destraba el demo pero NO cierra este registro: el
bug queda vivo para la próxima variable que alguien desactive.
