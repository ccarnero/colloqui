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

## Cómo arrancar un loop (los pasos, en orden)

1. Copiá el template a `manual-loops/<area>/<nombre>.md`, llenalo y borrá el
   bloque TEMPLATE NOTES.
2. **Aprobación humana del SPEC** — leelo de verdad: es el human boundary
   número uno, y las User decisions que apruebes acá el loop no las rediscute.
3. `git status` limpio — el motor se frena si no.
4. Precondición, una sola vez: `./scripts/validate-dev-mode.sh --with-e2e`.
   Si falla, los gates de iteración (G-a) se saltean y el skip SE REGISTRA
   como deuda en el Progress del SPEC (regla anti-zombie — un fallback
   temporal no se vuelve permanente en silencio).
5. En una sesión interactiva:
   `/manual-loop manual-loops/<area>/<nombre>.md` — opcionalmente con un id
   (`... T03`) para correr una sola tarea.
6. El loop se detiene solo: por bloqueo (te deja `BLOCKED.md` y se frena) o
   por fin de queue. Al cerrar reporta commits por tarea y qué servicios hay
   que rebuildear.

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
               texto de la tarea + las Constraints. Uno rechaza → nuevo
               intento con las objeciones.
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
| `reviewer` ×2 | `.claude/agents/reviewer.md` | Leer el diff + las Constraints y verificar contra el repo (solo lectura + codegraph) | Editar nada — solo devuelve APPROVED/REJECTED con objeciones |

El frontmatter también fija el modelo (implementer corre con un modelo más
potente) y la lista exacta de tools. Regla de oro: si querés cambiar CÓMO se
implementa o revisa (estilo, rechazos automáticos, tools), se edita el agente;
si querés cambiar QUÉ se construye y cómo se valida, se edita el SPEC.

## Sección por sección: quién la lee y cuándo

| Sección del SPEC | La consume | Cuándo |
|:---|:---|:---|
| Preámbulo (`> Task queue for...`) | Humanos y el orquestador | Al abrir el SPEC: dependencias, origen, topic de Engram |
| `## Goal` | Humanos + orquestador | Contexto: el resultado observable, SIN detalle de implementación |
| `## User decisions` | Humano + orquestador | Decisiones YA tomadas. El loop no las rediscute. Si una tarea depende de una, citala por número EN esa tarea — el implementer no ve esta sección |
| `## Prior art` (solo canónico) | El autor del SPEC | Registro del código que se REUSA. El motor no la reenvía: repetí cada cita dentro de la tarea que la usa |
| `## Constraints` | Implementer + reviewers | Viaja **entera con cada tarea** — en cada intento y en cada review. Las marcadas "automatic reviewer rejection" son ejecutables |
| `## Gates` | Orquestador | Se ejecuta verbatim **en cada intento**, en orden |
| `## Task queue` (`### T01...`) | Orquestador → implementer | De a UNA tarea; el resto del queue no se mira |
| Checkboxes (`- [ ] T01...`) | Orquestador | La fuente de verdad de qué está hecho y qué sigue |
| `## Out of scope` | Humano + orquestador | Lo que NO se toca, con motivo. El motor no la reenvía: las exclusiones que una tarea podría violar se repiten como DO NOT en esa tarea |
| `## Human boundaries` | Orquestador | Dónde el loop se detiene y espera tu OK explícito |

### El contrato de contexto (la regla nº 1 al escribir tareas)

El motor NO reenvía el SPEC entero a los agentes:

- El **implementer** recibe SOLO: el cuerpo de la tarea + su bloque Accept +
  la sección Constraints (y, en reintentos, los errores del intento anterior).
- Los **reviewers** reciben SOLO: el diff + el texto de la tarea + las
  Constraints.

Consecuencia: todo lo que el implementer tiene que saber vive DENTRO de la
tarea o en Constraints. Por eso los SPECs reales repiten las citas de prior
art en el cuerpo de cada tarea (ej.: workflow-toggle T03 cita
`workflows.service.ts:284-388` en su propio texto). Goal, User decisions,
Prior art y Out of scope son contexto de coordinación para vos y el
orquestador — no input de los agentes.

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
uno nuevo. Cuanto más precisa la cita, menos inventa. OJO: el motor no le
pasa esta sección al implementer — repetí la cita dentro de la tarea que la
usa (así lo hacen todos los SPECs reales).

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

La numeración es una convención compartida entre todos los SPECs: G1/G2 =
servicio principal, G3/G4 = otros servicios tocados, G5a/G5b = e2e de
cluster. Por eso un SPEC chico salta de G2 a G5a — no falta nada.

**Task queue** — cada tarea debe poder implementarse leyendo SOLO su
sección + Constraints. Incluí: scope concreto (paths, firmas), DO/DO NOT
explícitos, casos de test requeridos, y su bloque **Accept** (la prueba
específica de ESA tarea, además de los gates generales). Tareas de
investigación sin código son válidas (patrón "report task": los hallazgos
se registran en el progreso del SPEC).

**Checkboxes** — uno por tarea, mismo orden. El comando los marca al
commitear; no los toques a mano.

**Out of scope** — tan importante como el Goal. Cada exclusión con su
motivo en una línea. Es la defensa contra el scope creep de la IA — pero el
implementer no la ve: si una exclusión es violable desde una tarea puntual,
repetila como DO NOT explícito en esa tarea.

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
7. Poner contexto crítico solo en Goal/User decisions/Prior art → el
   implementer nunca lo ve. Todo lo que la tarea necesita va EN la tarea
   o en Constraints.
