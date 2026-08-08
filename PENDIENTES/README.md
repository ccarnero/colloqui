# Pendientes — sesión 2026-08-04/05

Class: register
Summary: Todo lo que quedó abierto tras la sesión de docs-truth-audit, el fix de seguridad E9, el cambio de formato del envelope y la cobertura e2e — con su evidencia y su estado.

Carpeta de trabajo, no un RECORD. Se edita en el lugar a medida que los ítems
se cierran. Cuando quede vacía, se borra.

**Lo que se cerró** (9 commits en `feature/fix-docs-codigo-manda`): la auditoría
docs-vs-código completa (T01–T10), la inyección SQL de E9, el formato `source`
del envelope, el canal `e2e-tests` y la cobertura de 8 de las 9 acciones de
workflow. Nada de eso está acá — esto es solo lo que **no** se hizo.

---

## Índice por prioridad

| # | Qué | Por qué importa | Archivo |
|---|---|---|---|
| 1 | Group B — 13 bugs reales | Cosas rotas en producción hoy | [`01-bugs-group-b.md`](01-bugs-group-b.md) |
| 2 | Group C — 3 tickets | Datos/config muertos o mentirosos | [`02-group-c.md`](02-group-c.md) |
| 3 | Group D+E — comentarios y strings | **CERRADO 08-07** (spec 3/3 + rule-5) | [`03-group-d-e.md`](03-group-d-e.md) |
| 4 | E3 — subject inconsistente | **CERRADO 08-08** (spec 3/3 + verificación en vivo) | [`04-e3-subject.md`](04-e3-subject.md) |
| 5 | Deuda de plataforma | Huecos estructurales encontrados | [`05-deuda-plataforma.md`](05-deuda-plataforma.md) |
| 6 | Cobertura e2e restante | `mcpCall`, lo único sin cubrir | [`06-e2e-restante.md`](06-e2e-restante.md) |
| 7 | Verificación pendiente | Lo que falta correr/mirar | [`07-verificacion.md`](07-verificacion.md) |
| 8 | Manifest gap — `defaultCache` | Paridad declarativa UI/SDK ↔ manifiesto | [`08-manifest-defaultcache-gap.md`](08-manifest-defaultcache-gap.md) |
| 9 | Hallazgos de la corrida Group C | **CERRADO 08-07** (H1+H2+H3; spec 5/5, suite 868/0) | [`09-hallazgos-group-c.md`](09-hallazgos-group-c.md) |
| 10 | Regla bash 3.2 → AGENTS.md | Constitución oral; huérfano de Group B | [`10-bash32-en-agents-md.md`](10-bash32-en-agents-md.md) |
| 11 | ValidationPipe: copias + trampa implicit-conversion | Hallazgo de plataforma de 09-T01d; spec listo | [`11-implicit-conversion.md`](11-implicit-conversion.md) |

---

## Lo más urgente

**El ítem 1 tiene cosas que están rotas ahora mismo en el cluster**, no deuda
teórica: un servicio corriendo 24/7 que nadie llama, conectores OAuth2 que
salen sin header de autenticación, un scheduler que no puede agendar nada, y
dos suites de tests que nunca ejecutan un solo test.

**El resto no bloquea nada.** Los ítems 2–6 son mejoras y deuda conocida.

---

## Nota sobre el alcance

Todo lo de acá salió de la auditoría `docs-truth-audit` (`manual-loops/architecture/docs-truth-audit.md`),
donde cada hallazgo tiene su evidencia citada, o de trabajo posterior de esta
misma sesión. Las escalaciones E1–E36 originales viven en el ledger congelado
`DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` — acá está solo lo que quedó sin
ejecutar, reagrupado para que se pueda accionar.
