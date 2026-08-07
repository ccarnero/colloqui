# 10 · La regla bash 3.2 no está en AGENTS.md — **CERRADO 2026-08-07**

> Ruling del usuario (Opción 1 + guard): baseline 3.2 formalizado como regla
> universal 9 de AGENTS.md; guard G16 en `doc-code-guards.sh` (probado con
> mutación: `mapfile` plantado → FAIL nombrando archivo y línea). Racional
> registrado: equipo mixto macOS/Linux — 3.2 es el único subset que corre
> nativo en ambos sin setup. El detalle de abajo queda como registro.

Class: register
Summary: Huérfano de la corrida Group B (declarado "separate ticket" en el Out of scope de `01-bugs-group-b.spec.md`, nunca ticketeado). La regla existe y se aplica, pero vive solo en comentarios dispersos de scripts.

---

## El gap

Los shell scripts del repo deben correr en **bash 3.2** (el `/bin/bash` de
macOS): sin `mapfile`, sin arrays asociativos, sin `case` dentro de `$()`.
La regla ya operó dos veces como constraint de loop (T07 de Group B eliminó el
único `mapfile` del repo, `purge-circuit-breakers.sh`), y los patrones
canónicos están citados en los specs (`scripts/reset/purge-temporal.sh:554`
while-read; `rebuild-changed.sh:100`).

Pero **AGENTS.md — el documento normativo único del repo — no la menciona**.
Hoy la regla es tradición oral: comentarios de scripts + constraints copiados
a mano en cada SPEC de manual-loop. Un dev (o un agente) que no pase por esos
specs puede reintroducir bash 4+ sin que nada lo marque.

## Fix

1. Agregar la regla a AGENTS.md (sección de shell/scripts): bash 3.2 target,
   los tres patrones prohibidos, y el puntero a los patrones canónicos.
2. Opcional (cierra el loop de verdad): un guard en
   `scripts/checks/doc-code-guards.sh` que rechace `mapfile|declare -A` bajo
   `scripts/` — hoy el repo está limpio, el guard congela eso.

Es un cambio de constitución (AGENTS.md manda sobre todo lo demás), por eso
quedó fuera de los loops de bugs: requiere aprobación humana explícita, no un
task de fix.
