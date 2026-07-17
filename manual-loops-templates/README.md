# Manual loops — guía de los templates

> Para quién: un dev que nunca escribió un SPEC de manual-loop y tiene que
> crear o leer uno. Los templates de esta carpeta son el punto de partida;
> los SPECs reales viven en `manual-loops/`.

## ¿Qué es un manual loop?

Es una forma de delegar una feature completa a agentes de IA, pero con
frenos: el trabajo se parte en tareas chicas, cada tarea tiene que pasar
**gates** (comandos que prueban que funciona) y una **doble revisión** de
código antes de commitear. Una tarea a la vez, sin excepciones.

Dos piezas trabajan juntas:

| Pieza | Qué es | Dónde vive |
|:---|:---|:---|
| El **comando** `/manual-loop` | El "motor": el programa que ejecuta el ciclo | `.claude/commands/manual-loop.md` |
| El **SPEC** | Los "datos": qué construir, con qué reglas, cómo validarlo | `manual-loops/<nombre>.md` (nace de estos templates) |

**Analogía**: el SPEC es una partitura y el comando es el músico. La
partitura tiene portada, indicaciones de tempo y las notas — pero el músico
no "toca la portada": consulta cada parte cuando le toca. Por eso el SPEC
**no se ejecuta de arriba a abajo**; cada sección se consume en un momento
distinto del ciclo (ver tabla más abajo).

## ¿Qué template uso?

| | `spec-simple-template.md` | `spec-canonical-template.md` |
|:---|:---|:---|
| Tamaño del loop | Chico, autocontenido | Grande o con historia |
| Depende de otros SPECs | No | Sí (sección "Depends on") |
| Prior art a proteger | No | Sí (código existente que se REUSA, no se reescribe) |
| Overrides de gates | No | Sí (reglas propias que pisan las heredadas) |
| Ejemplo real | `workflow-toggle.md` | `connector-invoke-api.md`, `samples-reorg.md` |

Regla práctica: arrancá con el simple; si te encontrás agregando
dependencias, prior art u overrides de gates, pasate al canónico.

## El ciclo, por tarea

Esto es lo que el comando hace con tu SPEC, tarea por tarea:

```
1. PREFLIGHT   git status limpio o se frena. Toma el próximo checkbox
               sin marcar (los checkboxes son el estado, no los títulos).
2. IMPLEMENT   Lanza el agente implementer con: el texto de ESA tarea +
               sus criterios de aceptación + la sección Constraints entera.
3. GATES       Corre los Gates del SPEC en orden, verbatim, y después el
               bloque Accept de la tarea. Primer fallo = intento fallido.
4. REVIEW      Dos reviewers EN PARALELO, cada uno ve solo el diff + el
               texto de la tarea. Uno rechaza → nuevo intento con las
               objeciones.
5. COMMIT      Gates verdes + 2× APPROVED → marca el checkbox, commitea
               SPEC + código juntos, mensaje convencional.
6. NEXT        Repite con el siguiente checkbox.
```

Límites duros: máximo 4 intentos por tarea; el mismo error 2 veces seguidas
bloquea al instante. Bloqueo = revert completo + entrada en `BLOCKED.md` +
el loop se detiene y te avisa.

## ¿Qué agentes ejecutan el trabajo?

El SPEC **no** elige agentes — eso es fijo del motor. El comando invoca dos
agentes por NOMBRE, y esos nombres se resuelven contra los archivos de
`.claude/agents/` (el frontmatter `name:` de cada uno):

| Agente | Archivo | Puede | No puede |
|:---|:---|:---|:---|
| `implementer` | `.claude/agents/implementer.md` | Leer y escribir código, correr comandos (Read/Edit/Write/Grep/Glob/Bash) | Commitear, tocar el SPEC, arrancar otra tarea |
| `reviewer` ×2 | `.claude/agents/reviewer.md` | Leer el diff y verificarlo contra el repo (solo lectura + codegraph) | Editar nada — solo devuelve APPROVED/REJECTED con objeciones |

El frontmatter también fija el modelo (implementer corre con un modelo más
potente) y la lista exacta de tools. Regla de oro: si querés cambiar CÓMO se
implementa o revisa (estilo, rechazos automáticos, tools), se edita el agente;
si querés cambiar QUÉ se construye y cómo se valida, se edita el SPEC.

## Sección por sección: quién la lee y cuándo

| Sección del SPEC | La consume | Cuándo |
|:---|:---|:---|
| Preámbulo (`> Task queue for...`) | Humanos y el orquestador | Al abrir el SPEC: dependencias, origen, topic de Engram |
| `## Goal` | Humanos + implementer | Contexto: el resultado observable, SIN detalle de implementación |
| `## User decisions` | Todos | Decisiones YA tomadas por el humano. El loop no las rediscute ni reinterpreta. Si una tarea las contradice, se frena y pregunta |
| `## Prior art` (solo canónico) | Implementer | Código existente que se REUSA. Reescribirlo = rechazo del reviewer |
| `## Constraints` | Implementer | Viaja **entera con cada tarea**, en cada intento |
| `## Gates` | Orquestador | Se ejecuta verbatim **en cada intento**, en orden |
| `## Task queue` (`### T01...`) | Orquestador → implementer | De a UNA tarea; el resto del queue no se mira |
| Checkboxes (`- [ ] T01...`) | Orquestador | La fuente de verdad de qué está hecho y qué sigue |
| `## Out of scope` | Implementer + reviewers | Lo que NO se toca, con motivo — evita "mejoras" espontáneas |
| `## Human boundaries` | Orquestador | Dónde el loop se detiene y espera tu OK explícito |

## Cómo llenar cada parte (con criterio)

**Goal** — una frase o lista corta de resultados observables. Test mental:
¿alguien puede verificar esto usando el sistema, sin leer el código? Si
describís archivos o funciones, eso va en las tareas, no acá.

**User decisions** — todo lo que el humano ya decidió y no quiere que la IA
"optimice": nombres, mapeos, defaults, secuencia. Numeralas: los SPECs
reales las citan por número ("decisión 6"). Si mañana cambiás una, se
agrega la fecha y se anota — no se borra la historia.

**Prior art** — con paths y líneas (`workflows.service.ts:284-388`). El
objetivo es que el implementer copie el patrón existente en vez de inventar
uno nuevo. Cuanto más precisa la cita, menos inventa.

**Constraints** — reglas que aplican a TODAS las tareas. Las tres primeras
del template (no debilitar tests, logging verboso, scripts idempotentes)
son innegociables en este repo. Agregá acá los límites de servicio ("solo
se toca `services/X`") y estilo.

**Gates** — comandos literales, copiables. Dos clases:
- **ITERATION** (ej. G5a): corren en cada intento — feedback rápido,
  dev-mode con código montado.
- **COMMIT GATE** (ej. G5b): corre una vez por tarea, con la imagen
  buildeada, justo antes del review. Si falla, es un intento fallido más.

El sufijo "(from T0N onward)" significa que ese gate recién aplica cuando
esa tarea existe — un gate que valida algo que T04 crea no puede correr en
T01.

**Task queue** — cada tarea debe poder implementarse leyendo SOLO su
sección + Constraints. Incluí: scope concreto (paths, firmas), DO/DO NOT
explícitos, casos de test requeridos, y su bloque **Accept** (la prueba
específica de ESA tarea, además de los gates generales). Tareas de
investigación sin código son válidas (patrón "report task": los hallazgos
se registran en el progreso del SPEC).

**Checkboxes** — uno por tarea, mismo orden. El comando los marca al
commitear; no los toques a mano.

**Out of scope** — tan importante como el Goal. Cada exclusión con su
motivo en una línea. Es la defensa contra el scope creep de la IA.

**Human boundaries** — mínimo siempre: el humano aprueba el SPEC antes de
la primera corrida, y el humano ejecuta el primer `--apply` de cualquier
script destructivo. Sumá lo que sea irreversible o de criterio de negocio.

## Convenciones de vida del SPEC

El SPEC es un documento **vivo**: crece mientras el loop corre.

- **Progreso**: los hallazgos y cambios se anotan en el propio SPEC
  ("**T02 findings (recorded \<fecha\>):**", numerados, con evidencia).
- **Cambios de diseño en vuelo**: `DESIGN CHANGE (human-approved <fecha>): ...`
  — siempre con aprobación humana.
- **Tareas nuevas**: se AGREGAN al final con provenance
  ("Added \<fecha\> after \<motivo\>"). **Nunca se renumeran** las
  existentes — los commits y Engram citan los números.
- **Reintentos tras bloqueo**: nota inline en la tarea:
  `> RETRY NOTE (<fecha>, after N-attempt block — see BLOCKED.md): ...`
- **Engram**: cada SPEC declara su topic (`namespace/kebab-slug`). Las
  decisiones y el resultado final se guardan ahí — es lo que le permite a
  una sesión futura retomar sin releer todo.

## Errores típicos de un primer SPEC

1. Goal con detalle de implementación → eso va en las tareas.
2. Tareas gigantes → si no cabe en un diff revisable, partila.
3. Gates "a mano" ("verificar que funcione") → tienen que ser comandos
   copiables con exit code.
4. Olvidar Out of scope → la IA va a "mejorar" cosas que no pediste.
5. Accept vacío o genérico → el Accept es la prueba específica de la
   tarea, no una repetición de G1/G2.
6. Renumerar tareas al editar → rompés las referencias históricas.
