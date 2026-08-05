# 2 · Group C — datos y config muertos o mentirosos

Class: register
Summary: Tres tickets de datos/configuración que existen pero no describen la realidad; uno de ellos es el compañero natural del fix de seguridad E9.

---

## E8 · Dos capas de defensa SQL que nunca se invocan

`validateSelectOnly()` y `enforceLimit()` en `skb-sql-safety.ts` están
**exportadas, testeadas y jamás llamadas** — mientras `security.md` las
presentaba como las capas 2 y 5 de una defensa de 5 capas.

**Es el compañero directo del fix de E9** (la inyección SQL que sí se cerró,
commit `c505edf6`). El fix parametrizó la query; esto cablea las dos capas que
la documentación ya daba por activas.

**Fix:** conectarlas al camino real de ejecución.

## E7 · El seed de referencia está mal en tres ejes

`services/agent-admin-service/data/jobs.yaml` — el fixture que un dev nuevo
copia:

| Campo | Dice | Debería |
|---|---|---|
| `interval: 3600` | se lee como **3600 minutos** (60 h) | horas |
| `enabled:` | `IJob` declara `is_active` | `is_active` |
| `payload.action` | `JobExecutorService` lee `payload.action_type` | `action_type` |

Con `payload.action` cae al `default` y termina en `execution_failed`.

**Fix:** corregir el fixture.

## E5 · Dos alertas de Prometheus sobre consumers que no existen

En `alerts.yaml`, grupo `nats-consumer-lag`: filtran por los durables
`webhook-dispatcher` y `event-processor`, que no aparecen en ningún
`DURABLE_NAME` bajo `services/`.

**Fix:** borrar los dos filtros (ticket de infra).
