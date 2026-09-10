# Manual loops — guía para arrancar

> Para quien va a correr un loop por primera vez. El procedimiento normativo es
> `DOCS/guides/manual-loop.md` (en inglés, es el que lee el orquestador); esto es la
> explicación de cómo se usa, qué esperar y qué hacer en cada parada. Actualizado
> 2026-09-10 después de las dos primeras corridas del motor restaurado.

## 1. Qué es, en una frase

Un procedimiento escrito que un LLM orquestador (Codex) sigue para hacer **una tarea a
la vez** de una lista, delegando en agentes que implementan, corren gates y revisan.
Vos escribís la lista (el SPEC), lo lanzás, y el loop te para en dos momentos: cuando
hay que commitear y cuando no puede seguir solo. Nada entra al repo sin que lo hayas
visto.

Analogía: un pipeline de CI con un humano en el botón de merge, donde los jobs son
agentes.

## 2. Los roles

| Rol | Quién | Qué hace | Qué ve |
|---|---|---|---|
| Orquestador | Codex, sesión principal | Lee el SPEC y el manual, delega, corre el ciclo, te reporta | Todo |
| `fp-dev` | agente | Implementa una tarea y hace pasar su Accept | Tarea, Accept, Constraints, fallos del intento anterior. No ve el SPEC entero |
| `script-runner` | agente barato | Corre los gates tal cual, devuelve exit codes y las últimas líneas | Sólo la lista de comandos |
| `fp-reviewer` ×2 | dos agentes en paralelo | APPROVED o REJECTED sobre el diff | Diff, tarea, Constraints. No se ven entre sí |
| `fp-qa` | agente, opcional | Completa tests que falten | Sólo si el SPEC dice `QA: fp-qa` |

Los roles viven en `.codex/agents/*.toml` (espejados en `.claude/agents/*.md`; el check
G19 los mantiene idénticos). No se editan para una tarea puntual: se editan cuando
cambia el procedimiento.

## 3. El ciclo por tarea

Para cada `- [ ]` de la sección Progress del SPEC, en orden:

1. **Preflight** — `python3 scripts/loop-commit.py <spec> <task> --check`. Anota lo que
   vos tenés sin commitear (es tuyo, lo ignora) y ve si hay trabajo previo de la tarea
   en el árbol.
2. **Implementar** — `fp-dev` con la tarea. Vuelve con un informe corto.
3. **QA** — sólo si el SPEC lo pide.
4. **Gates** — los comandos del SPEC, en orden, tal cual. Después el Accept de la tarea.
   El primer fallo termina el intento → vuelve a 2 con el error.
5. **Review ×2** — dos reviewers lanzados a la vez con el mismo diff.
6. **Objeciones** — un REJECTED vuelve a dev con las objeciones textuales. Cada vuelta
   cuenta un intento.
7. **Commit** — gates verdes + 2× APPROVED → corre el dry run de `loop-commit.py`, te
   pega la salida y **para**.
8. **Bloqueo** — se agotaron los 4 intentos, se pasó el tope de tokens, el mismo error
   dos veces seguidas, o algo que ningún intento puede resolver → handoff en
   `BLOCKED.md`, el trabajo queda en el árbol, **para**.
9. **Siguiente** — con tu commit hecho, siguiente `- [ ]`. Sin `- [ ]`, reporta y termina.

## 4. Cuándo te para y qué hacés

**Parada de commit** (la normal). Ves esto:

```
▸ T02 — J2 provision
▸ files of the task (all inside allowed paths):
 M e2e/journeys/j2-provision.spec.ts
▸ diffstat: …
▸ commit message: feat(loop): T02 J2 provision …
waiting for your ok — run again with --yes to commit
```

Mirás el diffstat. Si está bien, dos formas de seguir:

- `python3 scripts/loop-commit.py <spec> T02 --yes` desde tu terminal, y le contestás
  `committed`.
- O le contestás `--yes` a Codex y lo corre él. Mismo resultado; la diferencia es quién
  leyó el diff.

Si no está bien, le decís qué (en lenguaje natural) y vuelve a dev con eso como objeción.

**Parada de bloqueo.** Te dice por qué, y en `BLOCKED.md` hay un handoff con causa,
`file:line` y candidatos de fix. Tres salidas:

- Era el SPEC (ambiguo, contradictorio, scope corto): lo corregís vos, editás los
  Allowed write paths si hace falta, y le decís "resume T05 with …". Retoma desde el
  trabajo que quedó en el árbol.
- Era el producto: lo dejás bloqueado y abrís otro SPEC para el fix. El loop no cambia
  producto por su cuenta, y si el SPEC dice "no production code changes", tampoco
  aunque le digas "opción 2".
- Era el entorno (cluster caído, sandbox): arreglás el entorno, sesión nueva, mismo
  prompt. Ese intento no cuenta.

**Lo que nunca hace solo:** `git commit`, `git push`, `git stash`, tocar archivos fuera
de los Allowed write paths, escribir en el SPEC fuera de Progress, cambiar código de
producto en un SPEC de tests, inventar gates.

## 5. Cómo armar un SPEC

Copiá `manual-loops-templates/spec-simple-template.md` a `manual-loops/<nombre>.md`.
Secciones:

- **Goal**: el resultado observable, en 5 líneas. Sin implementación.
- **User decisions**: lo que ya decidiste y el loop no rediscute. Numeradas, para
  citarlas en las tareas.
- **Constraints**: reglas para todas las tareas. El implementer y los reviewers las
  reciben; es lo único del SPEC que ven.
- **Gates**: `QA: none|fp-qa`, `Gate executor: orchestrator|script-runner`, y los
  comandos en un bloque, uno por línea con su comentario `# G0 …`. Precondiciones si
  las hay.
- **Task queue**: `### T01 — título`, con `**Allowed write paths:**`, `**Non-goals:**`,
  qué hacer, y un bloque `**Accept**` con el comando que prueba la tarea.
- **Progress**: la lista `- [ ] T01 …` y `Token ceiling: N M per task`. El loop sólo
  escribe acá.
- **Out of scope** y **Human boundaries**.

Reglas duras, aprendidas a golpes:

- **Allowed write paths es la frontera.** El script de commit no stagea nada fuera de
  ellos. Si una tarea necesita tocar un archivo que no listaste, se bloquea; lo agregás
  vos y retomás.
- **Una tarea = un commit = un diff revisable.** Si no entra en un diffstat de 5
  archivos, son dos tareas.
- **Gates verbatim.** El loop corre lo que está en el bloque, tal cual. Sin `$VAR`, sin
  "y después lo que haga falta".
- **Accept es un comando con exit code**, no una frase. "Los tests pasan" no es Accept;
  `bun test test/x.spec.ts` sí.
- **No pidas cosas que el scope no permite.** T02 del ejemplo pedía un test de un export
  que sólo existía editando `index.ts`, que no estaba en los paths. Bloqueo garantizado.
- **No describas la UI de memoria.** T05 de e2e-journeys pedía "el id completo visible"
  y la consola muestra 8 caracteres a propósito. Mirá antes de escribir la aserción.
- **Verificá el entorno a mano antes de lanzar.** Si el Accept de T01 no corre desde tu
  terminal, tampoco va a correr adentro del loop, y vas a gastar intentos debuggeando
  el sandbox.
- **Tope de tokens por tarea**: 5–6 M para tareas chicas. Cruzarlo bloquea.

Ejemplos de referencia: `manual-loops/examples/channel-subject-parsing.md` (chico, un
paquete) y `manual-loops/e2e-journeys.md` (5 tareas, Playwright contra el cluster).

## 6. Lanzarlo

Setup una vez: `.codex/config.toml` ya tiene `sandbox_mode = "danger-full-access"` y
red habilitada; el límite real es el Allowed write paths, no el sandbox. Cluster dev
arriba si el SPEC lo usa (`curl -sf http://api-gateway…/health`).

```bash
cd ~/sources/yoizen/platform-cluster && tmux new -s loop
codex
```

Prompt (sesión nueva por SPEC, siempre):

```
Execute the manual loop for manual-loops/<spec>.md following DOCS/guides/manual-loop.md exactly. Run every unchecked task of the Progress list in order, one at a time. For each task: preflight with scripts/loop-commit.py --check, implement, gates through script-runner, two reviewers launched in parallel, then step 7: run the dry run of scripts/loop-commit.py, paste its output and stop the turn — do not commit. When I reply "committed", run --check again and continue with the next unchecked task. Stop the loop on a block. The SPEC's Progress section is the only part of the SPEC you edit.
```

`codex resume` no sirve para retomar después de cambiar config o de un bloqueo de
entorno: la sesión nueva es más barata que arrastrar el contexto.

Desde el teléfono: SSH a la Mac (Termius/Blink, Tailscale si estás afuera) →
`tmux attach -t loop`, y la app en `http://<mac>:4747/`.

## 7. La app de visualización (`agentes`)

Es sólo para mirar. El loop no sabe que existe y no depende de ella. Lee los rollouts de
Codex (`~/.codex/sessions/`), los guarda en `~/.agentes/agentes.sqlite` y sirve páginas
en `:4747`. Lee también el SPEC que la sesión está corriendo (lo saca del prompt), así
sabe si pide QA, quién corre los gates y cuál es el tope de tokens.

```bash
cd ~/sources/personal/agentes && bun run dev
```

**`/` — sala de control: qué pasa ahora.** De arriba a abajo:

- Una línea de números: agentes trabajando/terminados, duración, tokens, mensajes,
  desvíos, intervenciones tuyas y cuánto esperó por vos.
- La última nota del orquestador, completa. Es lo primero que leés al entrar.
- **Una fila por tarea**: `T03 · J3 execute`, la secuencia de manos en orden
  (`Sartre → Hume → Volta Kepler ↩ REJECTED ↺2 → Sartre → Hume → Kierkegaard Leibniz
  → ✋ commit · 2 min`) y a la derecha `↺2/4 · 5.3 M ⚠ · cerrada 20:30`. Los reviewers
  van en par; `↩ REJECTED` aparece después del par que rechazó; `✕` en un dev cuyo
  Accept falló; `↺n` marca el cambio de intento; `✋` es donde vos contestaste, con el
  tipo (commit, decisión, instrucción) y cuánto tardaste. El color de la derecha es el
  presupuesto: ámbar cerca del tope, rojo pasado.
- Sólo la tarea **abierta** despliega la tira de etapas: dev → gates → review ×2 →
  commit, con quién y cuánto lleva cada una; la última casilla dice "dry run → tu ok"
  cuando te está esperando.
- **Trabajando ahora**: una tarjeta por agente vivo, con reloj, tokens y el comando que
  está corriendo. Con la sesión terminada la sección no aparece.
- Los mensajes en vivo. Click en una fila de tarea los filtra; click en un chip abre el
  agente.

**`/loop.html` — la sesión entera, para analizar después.** Cuatro lecturas:

- A · anillo: por tarea, en qué etapa está, intentos n/4, rechazos, QA y gate executor
  del SPEC, `✋ humano` con lo que te pidió.
- B · matriz intento × etapa: una fila por intento, qué cambió entre vueltas; filas
  ámbar `✋` donde vos contestaste.
- C · cascada: quién delegó a quién, cuándo, cuánto duró; líneas `✋` con la espera
  humana sombreada; huecos largos comprimidos.
- D · feed: todo lo que pasó, agrupado, con tus prompts intercalados.

**`/turnos.html`** — lo mismo, cortado por prompt tuyo. **`/bitacora.html`** — el diario
completo sin agrupar.

**Desvíos** son cosas que el manual prohíbe y pasaron igual: reviewers secuenciales,
review sin gates, intento 5 de 4, tokens sobre el tope, mismo error dos veces, el
orquestador editando código. Cero desvíos con tareas cerradas = corrida limpia. Un
desvío no es un error del código; es un error del procedimiento, y sirve para ajustar
el manual.

**Intervenciones** (`✋`) son tus prompts después del primero, clasificados por lo que
el orquestador dijo antes de parar: "waiting for your ok" → commit, "blocked" →
decisión, otra cosa → instrucción. La proporción espera humana / tiempo total te dice
cuánto del reloj sos vos. En la primera corrida de 5 tareas fue 32 min de 60.

Si algo se ve raro: la app reconstruye todo de los eventos guardados; reiniciar alcanza
para casi todo. `bun run reset` borra la base y re-ingesta (lento, para cambios de
parser).

## 8. Lo que todavía no está resuelto

- Progress crece: el orquestador cumple "una línea por tarea" con líneas de 200
  caracteres. Se ignora.
- Un SPEC sobre el propio loop (que edita el manual, los roles, los templates) no es
  una cola de tareas: se hace a mano, con el humano. Ya lo intentamos en septiembre y
  salió mal.
- Si en las próximas corridas la mayoría de las paradas siguen siendo `--yes` sin mirar
  el diff, vale cambiar el prompt a "run --yes yourself when the dry run is clean" y
  quedarte sólo con las decisiones.
