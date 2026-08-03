# Loop Engineering — Playbook del proyecto

> Destilado de la construcción del message-tracking system (julio 2026).
> Este documento es la "receta" para armar y mantener loops en este repo,
> y el protocolo de preservación de conocimiento a años vista.
>
> **Punteros actualizados 2026-08-03** (docs-truth-audit T08). La destilación
> —las 4 piezas, las fronteras humanas, los anillos de verificación, las 7
> reglas de oro— se mantiene verbatim; lo único corregido son los artefactos
> concretos que nombraba y que ya no existen. El motor vigente es
> `.claude/commands/manual-loop.md` y la norma vigente es `AGENTS.md`; donde
> este playbook y AGENTS.md discrepen, **gana AGENTS.md**.
>
> Este archivo está en castellano y AGENTS.md regla 5 exige inglés para todo
> artefacto del repo — queda marcado para la ronda T09 (traducir, o declarar la
> excepción explícitamente).

---

## 1. Qué es un loop (una frase)

Hacer que Claude repita sin intervención humana el ciclo:
**tomar una tarea chica → hacerla → verificar contra un juez automático →
persistir → tomar la siguiente** — y que pare solo en las fronteras humanas.

## 2. Las 4 piezas (siempre las mismas)

| # | Pieza | Qué es | En este repo |
|---|-------|--------|--------------|
| 1 | **La cola** | Tareas chicas, ordenadas, cada una con criterio de aceptación ejecutable. Generada por máquina o descompuesta de un SPEC. | `manual-loops/<area>/<nombre>.md` (autorados desde `manual-loops-templates/`); históricamente también `.sdd/changes/*/tasks.md`. No hay ningún `SPEC.md` en la raíz. |
| 2 | **El juez** | Señal determinista que dice sí/no sin preguntar: tests, compilador, golden set. **Se construye ANTES que el producto.** | tests por servicio, `golden/labeled.tsv` (≥90%), los gates de cada SPEC (`G0` = `scripts/checks/doc-code-guards.sh`). El `lab/expected.tsv` sintético que se usó en el message-tracking system ya no está en el repo. |
| 3 | **Las reglas** | Prohibiciones y obligaciones en archivos que el agente siempre lee. Lo crítico se enforcea en código/permisos, no en prosa. | **`AGENTS.md` es la constitución** (único normativo, solo en la raíz — el guard K6g de `doc-code-guards.sh` prohíbe archivos de agente por componente); `TAXONOMY.md`; `CLAUDE.md` quedó reducido a un puntero de 5 líneas hacia AGENTS.md y además está gitignoreado |
| 4 | **El ciclo escrito** | El loop como slash command: pop → implement → verify → review → commit o revert. | `.claude/commands/manual-loop.md` (el motor genérico vigente; `build-console.md` es el predecesor específico de consola y sigue en el repo), `.claude/agents/{implementer,reviewer}.md` |

## 3. El ciclo estándar (secuencial, sin worktrees)

```
INVARIANTE: git status limpio entre tareas. Una tarea a la vez.

Por tarea:
1. Pre-flight: codegraph_status → sync si hay pending
2. IMPLEMENTER (model: opus): codegraph_explore antes de leer,
   codegraph_impact antes de editar. Estilo del repo: funciones puras,
   un function por archivo, Result types, schemas importados de
   packages/shared, correlación vía packages/observability.
3. Verificar: tests del paquete + gates (clasificador vs golden).
   Rojo = iterar. Máx 4 intentos. Mismo error 2 veces = no hay
   progreso: revert, anotar en BLOCKED.md, seguir con la próxima.
4. 2 REVIEWERS en paralelo (heredan modelo de la sesión = Fable,
   read-only + codegraph, solo ven el diff, asumen que está mal).
   Rechazan: schema duplicado, clasificación sin regla citada,
   correlación reinventada, workaround con justificación larga.
5. Verde + APPROVED = commit atómico. Si no = revert.
6. Siguiente tarea.
```

**Principio de paralelismo**: paralelizar lo que lee (reviewers),
serializar lo que escribe (un solo implementer). Como un RWLock.

**Modelos por rol**: inteligencia cara donde hay juicio (orquestación
y review), throughput barato donde hay volumen (implementación). Los nombres
de modelo concretos de julio 2026 envejecen en semanas y se omiten a propósito.
El `.ywai/sdd-profiles.json` que se citaba como referencia ya no existe: `.ywai/`
está retirado y prohibido de resucitar (AGENTS.md, "Retired 2026-07-29").

## 4. Las fronteras humanas (el loop DEBE parar acá)

- Nombrar una función de negocio / crear una regla de taxonomía
- Aprobar el alcance de una excepción (ej: stage-1 compliance)
- Etiquetar/corregir el golden set
- Aprobar inventarios destructivos (reset) — Claude escribe el script
  idempotente con dry-run; el humano ejecuta `--apply`
- Cualquier cambio bajo áreas sensibles declaradas

Si llega al humano algo que una máquina podía resolver → el loop está
mal armado. Si el loop resuelve solo algo de esta lista → peor.

## 5. Anillos de verificación (del más estricto al más tolerante)

```
set sintético (correcto por construcción)                 → exige 100%
golden/labeled.tsv (tráfico real auditado por humano)     → exige ≥90%
unknown en runtime (la alarma)                            → descubre lo nuevo
```

(El set sintético del message-tracking system vivía en `lab/expected.tsv`; ese
directorio ya no está en el repo. El anillo del medio sí: `golden/` conserva
`labeled.tsv`, `raw/`, `README.md` y `REVIEW.md`.)

`unknown` es la alarma, nunca el cajón: legacy tiene su bucket, lo no
implementado NO se pre-aprovisiona (cae en unknown cuando exista y ahí
se agrega la regla contra el subject real).

## 6. Preservación de conocimiento (proyecto a años vista)

### Las tres memorias, y qué va en cada una

| Memoria | Qué guarda | Vida |
|---------|-----------|------|
| **Repo (artefactos .md + golden + fixtures)** | La verdad vigente: reglas, schemas, drift conocido, decisiones con rationale | Años. Versionada. ES el trunk. |
| **Engram (`~/.engram/engram.db`)** | El PORQUÉ narrativo: decisiones, descubrimientos, bugs con causa raíz, session summaries. topic_key = upsert | Años. Cross-sesión y cross-herramienta. |
| **Sesiones de Claude** | El razonamiento en curso | Descartables. Branches efímeros. |

### El cuádruple de toda decisión

Cada decisión queda registrada con: **(1)** la regla (TAXONOMY.md §tabla),
**(2)** el porqué (decision note en §7), **(3)** la evidencia (cita de
código **por nombre**: constante, función o archivo — NO `archivo:línea`;
la auditoría de docs de agosto 2026 encontró decenas de cites `:NNN` podridos
en días, así que la forma vinculante es el nombre del símbolo),
**(4)** el topic engram. Con ese cuádruple,
cualquier persona (o Claude) dentro de dos años reconstruye el contexto
en minutos. Sin él, la arqueología cuesta días.

### Las reglas de oro

1. **Si tenés que re-explicar algo por chat, es documentación faltante.**
   Pará, escribilo en el artefacto que corresponde, seguí. Cada
   re-explicación es un bug de la memoria del proyecto.
2. **El humano nunca edita a mano los artefactos que el loop mantiene.**
   Las decisiones entran por prompt; el loop las persiste con su
   justificación. Así los artefactos nunca divergen de su historia.
3. **Reglamento, juez y código se mueven en el mismo commit.**
   (regla nueva de taxonomía = actualizar TAXONOMY.md + golden +
   clasificador juntos, o el gate miente en alguna dirección).
4. **Cuando el output está mal, arreglá el proceso, no el output.**
   Editar el prompt del loop / agregar una regla al reviewer > arreglar
   el commit a mano. El fix manual se pierde; el fix de proceso se
   repite solo para siempre.
5. **Test de autosuficiencia**: cada tanto, sesión 100% fresca que solo
   lee el repo. Si puede continuar el trabajo sin explicaciones, los
   artefactos están sanos. Si no, encontraste el hueco.
6. **Excepciones con nombre y ancho exacto**: todo caso especial
   (stage-1 accountid) vive en el borde, referencia su entrada de
   DRIFT.md, y lleva el test inverso que garantiza que no es más ancho
   que el caso conocido.
7. **Trabajar hacia atrás desde el final**: primero "¿cómo sé que está
   bien?" (el juez), después todo lo demás.

### Mantenimiento del sistema vivo

- **Evento nuevo aparece** → cae en `unknown` → alarma → decisión humana
  de regla → regla+golden+clasificador en un commit → engram.
- **Drift nuevo** → DRIFT.md con estado (confirmado / ya no se observa /
  sin tráfico para verificar). Re-verificar los hallazgos viejos tras
  cada cambio grande: un drift que "desaparece" también es información.
- **Golden envejece** → recapturar tras cambios de plataforma
  significativos; archivar el viejo con nombre (`golden/_pre-X/`),
  nunca borrar sin dejar los hallazgos en DRIFT.md.
- **Engram crece** → higiene periódica: `engram conflicts scan` para
  detectar memorias que se contradicen (una decisión nueva que pisa
  una vieja debe supersederla explícitamente, no convivir).
- **cowork/INDEX.md** es el mapa de los documentos de sesión — toda
  entrega grande deja su doc y actualiza el índice.

## 7. Historia de origen (para el que llegue después)

Este playbook salió de construir el message-tracking system:

1. **Fase 0 (definición)**: inventario de schemas (SCHEMAS.md),
   taxonomía con 7 decisiones de usuario (TAXONOMY.md), triángulo de
   verificación docs-vs-código-vs-tráfico (DRIFT.md), golden set
   etiquetado y auditado vía historias en castellano (golden/REVIEW.md).
2. **El juez encontró bugs reales antes de escribir el producto**:
   5 causas raíz de cadenas de correlación rotas, diagnosticadas y
   arregladas (fixes 1-4, commits b8e1480/f3cec02/0f806b0) — el golden
   definitivo (72 eventos) cierra 6/6 cadenas.
3. **Loop de construcción**: SPEC.md + build-console.md +
   implementer(opus)/reviewer(fable). Blockers escalados correctamente:
   regla 19 (platform/workflow-execution) y stage-1 ingress
   (canonical-with-known-drift, opción A).

Lección central: **la madurez de los artefactos del repo determina la
calidad del loop mucho más que la astucia del prompt.** El loop no se
diseña en el vacío — se destila de lo que el proyecto ya hace bien.
