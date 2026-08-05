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
| 3 | Group D+E — comentarios y strings | Documentación de registro que miente | [`03-group-d-e.md`](03-group-d-e.md) |
| 4 | E3 — subject inconsistente | Ticket de fix acordado | [`04-e3-subject.md`](04-e3-subject.md) |
| 5 | Deuda de plataforma | Huecos estructurales encontrados | [`05-deuda-plataforma.md`](05-deuda-plataforma.md) |
| 6 | Cobertura e2e restante | `mcpCall`, lo único sin cubrir | [`06-e2e-restante.md`](06-e2e-restante.md) |
| 7 | Verificación pendiente | Lo que falta correr/mirar | [`07-verificacion.md`](07-verificacion.md) |

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
